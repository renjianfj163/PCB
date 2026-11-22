using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PcbInstaller
{
	/// <summary>
	/// A per-user installer for the one PCB package: no admin, nothing outside
	/// %LOCALAPPDATA%, %APPDATA%, the user's desktop and HKCU. The whole
	/// application tree travels inside this exe as a zip resource, so the payload
	/// is not a renamed archive sitting next to an installer — it is the installer.
	///
	///   PCB-0.1.0-windows-x64.exe                asks for a folder, then installs
	///   ... --silent [--dir &lt;path&gt;] [--relaunch]   no UI; silent is what an upgrade uses
	///   &lt;install dir&gt;\uninstall.exe              removes everything it added
	///
	/// The package does not contain VS Code. The IDE button opens an editor the
	/// user installed themselves.
	/// </summary>
	internal static class Program
	{
		internal const string PayloadResource = "payload.zip";
		internal const string MetaResource = "meta.txt";
		internal const string UninstallerResource = "uninstall.exe";

		[STAThread]
		private static int Main(string[] args)
		{
			Meta meta = Meta.Read();
			bool silent = Has(args, "--silent");
			bool relaunch = Has(args, "--relaunch");
			meta.Dir = DirArgument(args);

			if (Has(args, "--uninstall"))
			{
				Uninstall(meta, silent);
				return 0;
			}

			Application.EnableVisualStyles();
			Application.SetCompatibleTextRenderingDefault(false);

			if (silent)
			{
				// Silence means the defaults the first screen would have offered.
				string error = Install(meta, Options.Defaults, null);
				if (error != null)
				{
					Console.Error.WriteLine(error);
					return 2;
				}
				if (relaunch) StartShell(meta.TargetDir);
				return 0;
			}

			using (InstallForm form = new InstallForm(meta))
			{
				Application.Run(form);
			}
			return 0;
		}

		/// <summary>The folder a silent run was pointed at, or null for the default.</summary>
		private static string DirArgument(string[] args)
		{
			for (int index = 0; index < args.Length; index++)
			{
				string arg = args[index];
				if (arg.Equals("--dir", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
				{
					return args[index + 1];
				}
				if (arg.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase))
				{
					return arg.Substring("--dir=".Length);
				}
			}
			return null;
		}

		private static bool Has(string[] args, string flag)
		{
			return Array.Exists(args, value => value.Equals(flag, StringComparison.OrdinalIgnoreCase));
		}

		/// <summary>
		/// Null when this folder may be installed into. A folder that already holds
		/// something which is not PCB is refused, never emptied: the installer only
		/// ever writes over its own tree.
		/// </summary>
		internal static string Validate(string dir)
		{
			if (dir == null || dir.Trim().Length == 0) return "安装目录不能为空。";

			string full;
			try
			{
				full = Path.GetFullPath(dir.Trim());
			}
			catch
			{
				return "这个目录看不懂，换一个再试。";
			}

			foreach (string programFiles in new[]
			{
				Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
				Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
			})
			{
				if (string.IsNullOrEmpty(programFiles)) continue;
				string root = programFiles.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
				if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
				{
					return "Program Files 需要管理员权限。PCB 是每用户安装，装在那里会失败，" +
						"请换到用户目录（例如默认位置）。";
				}
			}

			if (Directory.Exists(full) && Directory.GetFileSystemEntries(full).Length > 0)
			{
				bool mine = File.Exists(Path.Combine(full, "install-meta.txt")) &&
					File.Exists(Path.Combine(full, "PCBWindow.exe"));
				if (!mine)
				{
					return "这个目录不是空的，也不是 PCB。为了不删掉你的文件，安装不会继续——请换一个目录。";
				}
			}

			return null;
		}

		/// <summary>Extracts the payload, then writes everything that makes it a product.</summary>
		internal static string Install(Meta meta, Options options, IProgress<int> progress)
		{
			string dir;
			try
			{
				dir = meta.TargetDir;
			}
			catch (Exception error)
			{
				return "安装目录不可用：" + error.Message;
			}

			string refusal = Validate(dir);
			if (refusal != null) return refusal;

			try
			{
				// An upgrade replaces files under a window that is still running, so it
				// goes first. Only the shell from this folder is touched.
				StopShell(dir);
				Directory.CreateDirectory(dir);

				using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
				{
					if (stream == null) return "这个安装包里没有找到程序文件。";

					using (ZipArchive zip = new ZipArchive(stream, ZipArchiveMode.Read))
					{
						int done = 0;
						int total = Math.Max(1, zip.Entries.Count);
						foreach (ZipArchiveEntry entry in zip.Entries)
						{
							string target = Path.Combine(dir, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
							if (entry.FullName.EndsWith("/", StringComparison.Ordinal))
							{
								Directory.CreateDirectory(target);
							}
							else
							{
								Directory.CreateDirectory(Path.GetDirectoryName(target));
								// Overwrite in place: a previous PCB keeps its extra files, and
								// nothing outside this folder is ever touched.
								entry.ExtractToFile(target, true);
							}
							done++;
							if (progress != null) progress.Report(done * 100 / total);
						}
					}
				}

				File.WriteAllText(Path.Combine(dir, "install-meta.txt"), meta.Serialize());
				WriteUninstaller(dir);
				WriteCommands(dir);

				string shell = Path.Combine(dir, "PCBWindow.exe");
				WriteShortcut(StartMenuShortcut(meta.AppName), shell, dir, meta.AppName);
				if (options.Desktop) WriteShortcut(DesktopShortcut(meta.AppName), shell, dir, meta.AppName);
				else DeleteShortcut(DesktopShortcut(meta.AppName));

				if (options.Path) AddUserPath(Path.Combine(dir, "bin"));
				WriteRegistry(meta, dir);

				if (progress != null) progress.Report(100);
				return null;
			}
			catch (Exception error)
			{
				return "安装没有完成：" + error.Message;
			}
		}

		internal static void StartShell(string dir)
		{
			string exe = Path.Combine(dir, "PCBWindow.exe");
			if (!File.Exists(exe)) return;
			Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = dir });
		}

		private static void WriteUninstaller(string dir)
		{
			using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(UninstallerResource))
			{
				if (stream == null) return;
				string path = Path.Combine(dir, "uninstall.exe");
				using (FileStream file = File.Create(path)) stream.CopyTo(file);
			}
		}

		/// <summary>
		/// The install folder is not on PATH: its node.exe would shadow the system's.
		/// Only bin\ is added, and it holds two cmd shims.
		/// </summary>
		private static void WriteCommands(string dir)
		{
			string bin = Path.Combine(dir, "bin");
			Directory.CreateDirectory(bin);
			File.WriteAllText(
				Path.Combine(bin, "pcb.cmd"),
				"@echo off\r\nstart \"\" \"%~dp0..\\PCBWindow.exe\" %*\r\n",
				Encoding.ASCII);
			File.WriteAllText(
				Path.Combine(bin, "omp.cmd"),
				"@echo off\r\n\"%~dp0..\\omp.exe\" %*\r\n",
				Encoding.ASCII);
		}

		internal static string StartMenuShortcut(string appName)
		{
			return Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
				"Microsoft", "Windows", "Start Menu", "Programs", appName + ".lnk");
		}

		internal static string DesktopShortcut(string appName)
		{
			return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), appName + ".lnk");
		}

		private static void WriteShortcut(string linkPath, string exePath, string workingDir, string description)
		{
			string folder = Path.GetDirectoryName(linkPath);
			if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);

			Type type = Type.GetTypeFromProgID("WScript.Shell");
			if (type == null) return;
			dynamic shell = Activator.CreateInstance(type);
			dynamic link = shell.CreateShortcut(linkPath);
			link.TargetPath = exePath;
			link.WorkingDirectory = workingDir;
			// The window draws its own icon; the exe carries the same one for Explorer.
			link.IconLocation = exePath + ",0";
			link.Description = description;
			link.Save();
		}

		private static void DeleteShortcut(string linkPath)
		{
			try
			{
				if (File.Exists(linkPath)) File.Delete(linkPath);
			}
			catch
			{
				// A locked shortcut is not worth failing an install over.
			}
		}

		private static void WriteRegistry(Meta meta, string dir)
		{
			string key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + meta.RegistryKey;
			using (RegistryKey uninstall = Registry.CurrentUser.CreateSubKey(key))
			{
				if (uninstall == null) return;
				uninstall.SetValue("DisplayName", meta.AppName + " " + meta.Version);
				uninstall.SetValue("DisplayVersion", meta.Version);
				uninstall.SetValue("Publisher", "PCB Contributors");
				uninstall.SetValue("DisplayIcon", Path.Combine(dir, "PCBWindow.exe") + ",0");
				// The settings page reads this to upgrade the folder the user chose.
				uninstall.SetValue("InstallLocation", dir);
				uninstall.SetValue("UninstallString", "\"" + Path.Combine(dir, "uninstall.exe") + "\"");
				uninstall.SetValue("NoModify", 1, RegistryValueKind.DWord);
				uninstall.SetValue("NoRepair", 1, RegistryValueKind.DWord);
				uninstall.SetValue("EstimatedSize", (int)(meta.PayloadBytes / 1024), RegistryValueKind.DWord);
			}
		}

		/// <summary>Appends bin\ to the user PATH, once, and tells open shells.</summary>
		internal static void AddUserPath(string dir)
		{
			string current = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
			if (PathContains(current, dir)) return;
			string next = current.TrimEnd(';');
			next = next.Length == 0 ? dir : next + ";" + dir;
			Environment.SetEnvironmentVariable("Path", next, EnvironmentVariableTarget.User);
			BroadcastEnvironment();
		}

		/// <summary>Removes exactly the one entry the installer added.</summary>
		internal static void RemoveUserPath(string dir)
		{
			string current = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User);
			if (current == null || !PathContains(current, dir)) return;
			string next = "";
			foreach (string part in current.Split(';'))
			{
				if (part.Trim().Length == 0) continue;
				if (string.Equals(part.Trim().TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) continue;
				next = next.Length == 0 ? part.Trim() : next + ";" + part.Trim();
			}
			Environment.SetEnvironmentVariable("Path", next, EnvironmentVariableTarget.User);
			BroadcastEnvironment();
		}

		private static bool PathContains(string path, string dir)
		{
			foreach (string part in path.Split(';'))
			{
				if (string.Equals(part.Trim().TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) return true;
			}
			return false;
		}

		[DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
		private static extern IntPtr SendMessageTimeout(
			IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);

		/// <summary>Already-open shells (Explorer, cmd) re-read PATH only on this message.</summary>
		private static void BroadcastEnvironment()
		{
			try
			{
				UIntPtr ignored;
				SendMessageTimeout(new IntPtr(0xffff), 0x1A, UIntPtr.Zero, "Environment", 0x0002, 5000, out ignored);
			}
			catch
			{
				// Not fatal: new windows still get the new PATH from the registry.
			}
		}

		private static void Uninstall(Meta meta, bool silent)
		{
			string dir;
			try
			{
				dir = meta.TargetDir;
			}
			catch (Exception error)
			{
				if (!silent) MessageBox.Show("找不到安装目录：" + error.Message, meta.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
				return;
			}

			StopShell(dir);
			DeleteShortcut(StartMenuShortcut(meta.AppName));
			DeleteShortcut(DesktopShortcut(meta.AppName));
			RemoveUserPath(Path.Combine(dir, "bin"));

			try
			{
				Registry.CurrentUser.DeleteSubKeyTree(
					@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + meta.RegistryKey, false);
			}
			catch
			{
			}

			// The uninstaller lives inside the folder it removes, so the delete is
			// handed to a detached cmd that waits a moment and then takes the tree.
			// %USERPROFILE%\.pcb and omp's own sessions are outside it and stay.
			string script = "ping -n 3 127.0.0.1 >nul & rmdir /s /q \"" + dir + "\"";
			Process.Start(new ProcessStartInfo("cmd.exe", "/c " + script) { CreateNoWindow = true, UseShellExecute = false });

			if (!silent) MessageBox.Show(meta.AppName + " 已卸载。", meta.AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
		}

		private static string ImagePath(Process process)
		{
			try
			{
				ProcessModule module = process.MainModule;
				return module == null ? null : module.FileName;
			}
			catch
			{
				return null;
			}
		}

		internal static void StopShell(string dir)
		{
			foreach (Process process in Process.GetProcessesByName("PCBWindow"))
			{
				try
				{
					if (string.Equals(ImagePath(process), Path.Combine(dir, "PCBWindow.exe"), StringComparison.OrdinalIgnoreCase))
					{
						process.Kill();
						process.WaitForExit(3000);
					}
				}
				catch
				{
				}
			}
		}

		internal static bool WebView2Installed()
		{
			const string client = @"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
			foreach (RegistryKey root in new[] { Registry.LocalMachine, Registry.CurrentUser })
			{
				foreach (string path in new[] { @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\", @"SOFTWARE\Microsoft\EdgeUpdate\Clients\" })
				{
					try
					{
						using (RegistryKey key = root.OpenSubKey(path + client))
						{
							RegistryKey entry = key;
							string version = entry == null ? null : entry.GetValue("pv") as string;
							if (!string.IsNullOrEmpty(version) && version != "0.0.0.0") return true;
						}
					}
					catch
					{
					}
				}
			}
			return false;
		}
	}

	/// <summary>What the first screen chose; silence gets the defaults.</summary>
	internal sealed class Options
	{
		internal bool Desktop = true;
		internal bool Path = true;

		internal static Options Defaults
		{
			get { return new Options(); }
		}
	}

	/// <summary>The name, registry key and version written into this installer.</summary>
	internal sealed class Meta
	{
		internal string AppName = "PCB";
		internal string RegistryKey = "PCB";
		internal string Version = "0.1.0";
		internal long PayloadBytes;
		/// <summary>--dir, when a silent upgrade names the folder. Null means "decide".</summary>
		internal string Dir;

		internal string TargetDir
		{
			get
			{
				if (!string.IsNullOrEmpty(Dir)) return Path.GetFullPath(Dir);
				string registered = RegisteredDir();
				if (!string.IsNullOrEmpty(registered)) return registered;
				return Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"Programs", AppName);
			}
		}

		/// <summary>An upgrade goes back where the last install went, never to the default.</summary>
		private string RegisteredDir()
		{
			try
			{
				using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
					@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + RegistryKey))
				{
					if (key == null) return null;
					string dir = key.GetValue("InstallLocation") as string;
					if (string.IsNullOrEmpty(dir)) return null;
					if (!File.Exists(Path.Combine(dir, "PCBWindow.exe"))) return null;
					return dir;
				}
			}
			catch
			{
				return null;
			}
		}

		internal static Meta Read()
		{
			Meta meta = new Meta();
			using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(Program.MetaResource))
			{
				if (stream == null) return meta;
				using (StreamReader reader = new StreamReader(stream))
				{
					string line;
					while ((line = reader.ReadLine()) != null)
					{
						int split = line.IndexOf('=');
						if (split <= 0) continue;
						string key = line.Substring(0, split).Trim();
						string value = line.Substring(split + 1).Trim();
						if (key == "AppName") meta.AppName = value;
						else if (key == "RegistryKey") meta.RegistryKey = value;
						else if (key == "Version") meta.Version = value;
					}
				}
			}
			using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(Program.PayloadResource))
			{
				if (stream != null) meta.PayloadBytes = stream.Length;
			}
			return meta;
		}

		internal string Serialize()
		{
			return "AppName=" + AppName + "\r\nRegistryKey=" + RegistryKey + "\r\nVersion=" + Version + "\r\n";
		}
	}

	/// <summary>
	/// Two screens in one window: pick a folder, then progress. A silent run never
	/// builds this at all.
	/// </summary>
	internal sealed class InstallForm : Form
	{
		private readonly Meta meta;
		private readonly Label where;
		private readonly TextBox folder;
		private readonly Button browse;
		private readonly CheckBox desktop;
		private readonly CheckBox path;
		private readonly Label problem;
		private readonly Label status;
		private readonly ProgressBar bar;
		private readonly Button action;
		private readonly Button cancel;
		private readonly CheckBox launch;
		private bool done;
		private bool started;

		internal InstallForm(Meta meta)
		{
			this.meta = meta;
			Text = "安装 " + meta.AppName + " " + meta.Version;
			FormBorderStyle = FormBorderStyle.FixedDialog;
			StartPosition = FormStartPosition.CenterScreen;
			MaximizeBox = false;
			MinimizeBox = false;
			ClientSize = new Size(528, 302);
			Font = new Font("Segoe UI", 9f);

			where = new Label
			{
				Text = "装到哪个文件夹",
				AutoSize = false,
				Bounds = new Rectangle(20, 18, 480, 20),
			};
			folder = new TextBox
			{
				Bounds = new Rectangle(20, 42, 396, 25),
				Text = SafeTargetDir(meta),
			};
			browse = new Button { Text = "浏览…", Bounds = new Rectangle(424, 41, 84, 27) };
			browse.Click += delegate { PickFolder(); };

			desktop = new CheckBox
			{
				Text = "创建桌面快捷方式",
				Checked = true,
				Bounds = new Rectangle(20, 78, 460, 22),
			};
			path = new CheckBox
			{
				Text = "把 pcb 命令加进用户 PATH（不加安装目录本身）",
				Checked = true,
				Bounds = new Rectangle(20, 102, 460, 22),
			};

			problem = new Label
			{
				AutoSize = false,
				Bounds = new Rectangle(20, 132, 488, 56),
				ForeColor = Color.Firebrick,
				Text = "",
			};
			status = new Label
			{
				AutoSize = false,
				Bounds = new Rectangle(20, 42, 488, 40),
				Visible = false,
			};
			bar = new ProgressBar
			{
				Bounds = new Rectangle(20, 84, 488, 14),
				Minimum = 0,
				Maximum = 100,
				Visible = false,
			};
			launch = new CheckBox
			{
				Text = "安装完成后打开 " + meta.AppName,
				Checked = true,
				Visible = false,
				Bounds = new Rectangle(20, 112, 488, 22),
			};

			cancel = new Button { Text = "取消", Bounds = new Rectangle(324, 258, 84, 30) };
			cancel.Click += delegate { Close(); };
			action = new Button { Text = "安装", Bounds = new Rectangle(416, 258, 92, 30) };
			action.Click += delegate
			{
				if (!done) Start();
				else Finish();
			};

			Controls.Add(where);
			Controls.Add(folder);
			Controls.Add(browse);
			Controls.Add(desktop);
			Controls.Add(path);
			Controls.Add(problem);
			Controls.Add(status);
			Controls.Add(bar);
			Controls.Add(launch);
			Controls.Add(cancel);
			Controls.Add(action);
		}

		private static string SafeTargetDir(Meta meta)
		{
			try
			{
				return meta.TargetDir;
			}
			catch
			{
				return Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", meta.AppName);
			}
		}

		private void PickFolder()
		{
			using (FolderBrowserDialog picker = new FolderBrowserDialog())
			{
				picker.Description = "选择 " + meta.AppName + " 的安装目录";
				picker.SelectedPath = folder.Text;
				picker.ShowNewFolderButton = true;
				if (picker.ShowDialog(this) == DialogResult.OK) folder.Text = picker.SelectedPath;
			}
		}

		private void Start()
		{
			string dir = folder.Text;
			string refusal = Program.Validate(dir);
			if (refusal != null)
			{
				problem.Text = refusal;
				return;
			}

			problem.Text = "";
			meta.Dir = dir;
			started = true;
			where.Visible = false;
			folder.Visible = false;
			browse.Visible = false;
			desktop.Visible = false;
			path.Visible = false;
			status.Visible = true;
			bar.Visible = true;
			status.Text = "正在安装到 " + dir;
			action.Enabled = false;
			cancel.Enabled = false;

			Options options = new Options { Desktop = desktop.Checked, Path = path.Checked };
			ThreadPool.QueueUserWorkItem(delegate { Work(options); });
		}

		private void Work(Options options)
		{
			Progress<int> progress = new Progress<int>(value =>
			{
				if (IsDisposed) return;
				bar.Value = Math.Min(100, Math.Max(0, value));
			});
			string error = Program.Install(meta, options, progress);
			if (IsDisposed) return;
			try
			{
				Invoke((MethodInvoker)delegate { Finished(error, options); });
			}
			catch (ObjectDisposedException)
			{
			}
		}

		private void Finished(string error, Options options)
		{
			done = true;
			action.Enabled = true;
			cancel.Enabled = true;
			if (error != null)
			{
				bar.Visible = false;
				status.Visible = false;
				where.Visible = !started;
				folder.Visible = !started;
				browse.Visible = !started;
				problem.Text = error;
				action.Text = "关闭";
				return;
			}

			bar.Value = 100;
			status.Text = meta.AppName + " 已安装到 " + meta.TargetDir + "。";
			action.Text = "完成";
			launch.Visible = true;
			if (options.Path)
			{
				status.Text += "\r\n已经开着的 cmd 要新开一个窗口，才能敲 pcb。";
			}
			if (!Program.WebView2Installed())
			{
				status.Text = meta.AppName + " 已安装。这台机器还没有 WebView2 运行时，打开窗口前需要先装它。";
				launch.Checked = false;
				launch.Text = "打开 WebView2 下载页";
			}
		}

		private void Finish()
		{
			if (launch.Visible && launch.Checked)
			{
				if (Program.WebView2Installed())
				{
					Program.StartShell(meta.TargetDir);
				}
				else
				{
					Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
				}
			}
			Close();
		}
	}
}
