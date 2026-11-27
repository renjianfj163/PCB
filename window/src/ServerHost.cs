using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace PcbWindow
{
	/// <summary>
	/// Owns the one thing the window needs from the repo: a listening
	/// http://127.0.0.1:7777. It starts `node server/main.ts` only when nothing
	/// is listening, and it only ever stops the node it started itself.
	/// </summary>
	internal sealed class ServerHost : IDisposable
	{
		public const string Host = "127.0.0.1";
		public const int Port = 7777;
		public const string Url = "http://127.0.0.1:7777";

		private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(20);
		private static readonly TimeSpan StopTimeout = TimeSpan.FromSeconds(3.5);
		/// <summary>Deaths closer together than this count as one crash loop.</summary>
		private static readonly TimeSpan CrashWindow = TimeSpan.FromMinutes(2);
		private const int RestartTries = 3;
		private const int TailLines = 200;

		private readonly string root;
		private readonly object gate = new object();
		/// <summary>The last lines node wrote, kept for the exit record.</summary>
		private readonly Queue<string> tail = new Queue<string>();
		private Process child;
		private IntPtr job;
		private bool stopping;
		private bool restarting;
		private int deaths;
		private DateTime firstDeath = DateTime.MinValue;

		/// <summary>The service came back after dying: the page has to reload to reconnect.</summary>
		public event EventHandler Restarted;
		/// <summary>Three deaths inside the crash window: the window says so instead of retrying forever.</summary>
		public event EventHandler GaveUp;

		public ServerHost(string root)
		{
			this.root = root;
		}

		/// <summary>The repo root: the nearest folder above the exe holding server/main.ts.</summary>
		public static string FindRoot()
		{
			string dir = AppDomain.CurrentDomain.BaseDirectory;
			for (int level = 0; level < 8 && !string.IsNullOrEmpty(dir); level++)
			{
				string candidate = Path.Combine(dir, "server", "main.ts");
				if (File.Exists(candidate)) return dir;
				DirectoryInfo parent = Directory.GetParent(dir);
				if (parent == null) break;
				dir = parent.FullName;
			}
			return null;
		}

		public static bool Listening(int timeoutMs)
		{
			using (TcpClient client = new TcpClient())
			{
				try
				{
					IAsyncResult pending = client.BeginConnect(Host, Port, null, null);
					if (!pending.AsyncWaitHandle.WaitOne(timeoutMs)) return false;
					client.EndConnect(pending);
					return client.Connected;
				}
				catch
				{
					return false;
				}
			}
		}

		/// <summary>Null when the port answers; otherwise one sentence for the window.</summary>
		public async Task<string> EnsureAsync()
		{
			if (Listening(400)) return null;

			if (string.IsNullOrEmpty(root))
			{
				return "没有找到 server/main.ts，这个窗口起不了本机服务。";
			}

			try
			{
				Start();
			}
			catch (Exception error)
			{
				return "启动 node 失败：" + error.Message;
			}

			DateTime deadline = DateTime.UtcNow + StartTimeout;
			while (DateTime.UtcNow < deadline)
			{
				if (Listening(400)) return null;
				if (child != null && child.HasExited)
				{
					return "本机服务启动后立刻退出了，127.0.0.1:7777 没有起来。";
				}
				await Task.Delay(250);
			}
			return "本机服务 20 秒内没有起来，127.0.0.1:7777 仍然连不上。";
		}

		private void Start()
		{
			// The installer drops node.exe next to the shell: a machine without Node
			// installed must still get a window, so the bundled runtime wins over PATH.
			string bundledNode = Path.Combine(root, "node.exe");
			string nodeExe = File.Exists(bundledNode) ? bundledNode : "node";

			ProcessStartInfo info = new ProcessStartInfo(nodeExe, "server/main.ts");
			info.WorkingDirectory = root;
			info.UseShellExecute = false;
			info.CreateNoWindow = true;
			info.RedirectStandardOutput = true;
			info.RedirectStandardError = true;
			// node writes UTF-8; the default decode would turn Chinese into mojibake in the log.
			info.StandardOutputEncoding = System.Text.Encoding.UTF8;
			info.StandardErrorEncoding = System.Text.Encoding.UTF8;
			info.EnvironmentVariables["PCB_HOST"] = Host;
			info.EnvironmentVariables["PCB_PORT"] = Port.ToString();
			string bundledOmp = Path.Combine(root, "omp.exe");
			if (File.Exists(bundledOmp)) info.EnvironmentVariables["PCB_OMP"] = bundledOmp;

			Process started = new Process();
			started.StartInfo = info;
			started.EnableRaisingEvents = true;
			// Both pipes must be drained or a full buffer stalls node. stderr is the
			// only evidence a crash leaves, so it goes to the log as it arrives; both
			// streams are also kept so the exit record can quote them.
			started.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Remember(e.Data, false); };
			started.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Remember(e.Data, true); };
			started.Exited += delegate { OnExit(started); };
			started.Start();
			if (job != IntPtr.Zero)
			{
				Job.Release(job);
				job = IntPtr.Zero;
			}
			job = Job.Attach(started.Handle);
			child = started;
			Diagnostics.Log("node started pid=" + started.Id + " job=" + job);
			started.BeginOutputReadLine();
			started.BeginErrorReadLine();
		}

		private void Remember(string line, bool isError)
		{
			if (line == null) return;
			if (line.Length > 400) line = line.Substring(0, 400) + "…";
			lock (tail)
			{
				tail.Enqueue(line);
				while (tail.Count > TailLines) tail.Dequeue();
			}
			if (isError) Diagnostics.Log("node stderr " + line);
		}

		private void DrainTail()
		{
			string[] lines;
			lock (tail)
			{
				lines = tail.ToArray();
				tail.Clear();
			}
			if (lines.Length == 0)
			{
				Diagnostics.Log("node left no output");
				return;
			}
			Diagnostics.Log("node output before exit (" + lines.Length + " lines):");
			foreach (string line in lines) Diagnostics.Log("  | " + line);
		}

		/// <summary>
		/// Node died on its own. Its output is already in the log; restart it, and
		/// after a crash loop say so instead of spinning forever. Runs off the UI
		/// thread, so the subscribers marshal what they do.
		/// </summary>
		private void OnExit(Process process)
		{
			string code = "?";
			try { code = process.ExitCode.ToString(); } catch { }
			Diagnostics.Log("node exited pid=" + process.Id + " code=" + code);
			if (stopping) return;
			DrainTail();

			lock (gate)
			{
				// A start already in flight owns the retry loop; this death is its business.
				if (restarting) return;
				restarting = true;
				DateTime now = DateTime.UtcNow;
				if (deaths == 0 || now - firstDeath > CrashWindow)
				{
					deaths = 0;
					firstDeath = now;
				}
				deaths++;
				if (deaths > RestartTries)
				{
					stopping = true;
					restarting = false;
					Diagnostics.Log("node died " + deaths + " times in " + (int)CrashWindow.TotalMinutes + " min; giving up");
					EventHandler giveUp = GaveUp;
					if (giveUp != null) giveUp(this, EventArgs.Empty);
					return;
				}
			}

			for (int attempt = 1; attempt <= RestartTries; attempt++)
			{
				if (stopping) break;
				Thread.Sleep(1000);
				if (Listening(400)) { SignalRestarted("another process took the port"); return; }
				try
				{
					Start();
				}
				catch (Exception error)
				{
					Diagnostics.Log("restart " + attempt + " failed to start: " + error.Message);
					continue;
				}
				Diagnostics.Log("restart " + attempt + ": waiting for the port");
				DateTime deadline = DateTime.UtcNow + StartTimeout;
				while (DateTime.UtcNow < deadline && !stopping)
				{
					if (Listening(400)) { SignalRestarted("attempt " + attempt); return; }
					Process current = child;
					bool exited = false;
					if (current != null)
					{
						try { exited = current.HasExited; } catch { }
					}
					if (exited)
					{
						Diagnostics.Log("restart " + attempt + ": node exited again");
						break;
					}
					Thread.Sleep(250);
				}
			}

			lock (gate) { restarting = false; }
			if (stopping) return;
			Diagnostics.Log("node is not listening after " + RestartTries + " restarts");
			EventHandler failed = GaveUp;
			if (failed != null) failed(this, EventArgs.Empty);
		}

		private void SignalRestarted(string why)
		{
			lock (gate) { restarting = false; }
			Process process = child;
			Diagnostics.Log("node is listening again (" + why + ", pid=" + (process == null ? "?" : process.Id.ToString()) + ")");
			EventHandler restarted = Restarted;
			if (restarted != null) restarted(this, EventArgs.Empty);
		}

		/// <summary>
		/// Tray "quit": node gets a real Ctrl+C (its SIGINT), up to about three
		/// seconds, then it is killed. A server somebody else started is left alone.
		/// </summary>
		public void Stop()
		{
			stopping = true;
			Process process = child;
			child = null;
			if (process == null) return;

			try
			{
				if (!process.HasExited)
				{
					SendInterrupt(process);
					if (!process.WaitForExit((int)StopTimeout.TotalMilliseconds))
					{
						process.Kill();
						process.WaitForExit(2000);
					}
				}
			}
			catch
			{
				// already gone
			}
			finally
			{
				Diagnostics.Log("node stopped pid=" + process.Id);
				Job.Release(job);
				job = IntPtr.Zero;
				try { process.Dispose(); } catch { }
			}
		}

		private static void SendInterrupt(Process process)
		{
			try
			{
				if (!Native.AttachConsole((uint)process.Id)) { Diagnostics.Log("interrupt: attach failed"); return; }
				Diagnostics.Log("interrupt: attached");
				try
				{
					// Program.Main installed this handler for the life of the process:
					// we sit on the same console for a moment and must not die with node.
					// Target only node's own process group: addressing the whole console
					// would deliver the Ctrl+C to this process as well.
					Native.GenerateConsoleCtrlEvent(Native.CtrlCEvent, (uint)process.Id);
					Diagnostics.Log("interrupt: sent");
					System.Threading.Thread.Sleep(250);
					Diagnostics.Log("interrupt: survived");
				}
				finally
				{
					Native.FreeConsole();
					Diagnostics.Log("interrupt: detached");
				}
			}
			catch
			{
				// no console to talk to: the caller falls back to Kill
			}
		}

		public void Dispose()
		{
			Stop();
		}
	}
}
