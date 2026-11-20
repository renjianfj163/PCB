using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
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

		private readonly string root;
		private Process child;
		private IntPtr job;

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
			ProcessStartInfo info = new ProcessStartInfo("node", "server/main.ts");
			info.WorkingDirectory = root;
			info.UseShellExecute = false;
			info.CreateNoWindow = true;
			info.RedirectStandardOutput = true;
			info.RedirectStandardError = true;
			info.EnvironmentVariables["PCB_HOST"] = Host;
			info.EnvironmentVariables["PCB_PORT"] = Port.ToString();

			child = new Process();
			child.StartInfo = info;
			child.EnableRaisingEvents = true;
			// The pipes are drained and dropped: a full buffer would stall node.
			child.OutputDataReceived += delegate { };
			child.ErrorDataReceived += delegate { };
			child.Start();
			job = Job.Attach(child.Handle);
			Diagnostics.Log("node started pid=" + child.Id + " job=" + job);
			child.BeginOutputReadLine();
			child.BeginErrorReadLine();
		}

		/// <summary>
		/// Tray "quit": node gets a real Ctrl+C (its SIGINT), up to about three
		/// seconds, then it is killed. A server somebody else started is left alone.
		/// </summary>
		public void Stop()
		{
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
