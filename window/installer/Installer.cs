using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PcbInstaller
{
	/// <summary>
	/// A per-user installer for the one PCB package: no admin, nothing outside
	/// %LOCALAPPDATA%, %APPDATA% and HKCU. The whole application tree travels
	/// inside this exe as a zip resource, so the payload is not a renamed archive
	/// sitting next to an installer — it is the installer.
	///
	///   PCB-0.1.0-windows-x64.exe                installs "PCB"
	///   ... --silent                             no UI, no launch
	///   <install dir>\uninstall.exe              removes everything it added
	///
	/// The package does not contain VS Code. The IDE button opens an editor
	/// the user installed themselves.
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
			bool silent = Array.Exists(args, a => a.Equals("--silent", StringComparison.OrdinalIgnoreCase));

			if (Array.Exists(args, a => a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase)))
			{
				Uninstall(meta, silent);
				return 0;
			}

			Application.EnableVisualStyles();
			Application.SetCompatibleTextRenderingDefault(false);

			if (silent)
			{
				string error = Install(meta, null);
				if (error != null)
				{
					Console.Error.WriteLine(error);
					return 2;
				}
				return 0;
			}

			using (InstallForm form = new InstallForm(meta))
			{
				Application.Run(form);
			}
			return 0;
		}

		/// <summary>Extracts the payload, writes the uninstaller and registers it.</summary>
		internal static string Install(Meta meta, IProgress<int> progress)
		{
			try
			{
				string dir = meta.TargetDir;
				if (Directory.Exists(dir)) Directory.Delete(dir, true);
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
								entry.ExtractToFile(target, true);
							}
							done++;
							if (progress != null) progress.Report(done * 100 / total);
						}
					}
				}

				File.WriteAllText(Path.Combine(dir, "install-meta.txt"), meta.Serialize());
				WriteUninstaller(dir);
				WriteShortcut(meta, dir);
				WriteRegistry(meta, dir);
				if (progress != null) progress.Report(100);
				return null;
			}
			catch (Exception error)
			{
				return "安装没有完成：" + error.Message;
			}
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

		private static void WriteShortcut(Meta meta, string dir)
		{
			string programs = Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
				"Microsoft", "Windows", "Start Menu", "Programs");
			Directory.CreateDirectory(programs);

			Type type = Type.GetTypeFromProgID("WScript.Shell");
			if (type == null) return;
			dynamic shell = Activator.CreateInstance(type);
			dynamic link = shell.CreateShortcut(Path.Combine(programs, meta.AppName + ".lnk"));
			link.TargetPath = Path.Combine(dir, "PCBWindow.exe");
			link.WorkingDirectory = dir;
			link.IconLocation = Path.Combine(dir, "PCBWindow.exe") + ",0";
			link.Description = meta.AppName;
			link.Save();
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
				uninstall.SetValue("InstallLocation", dir);
				uninstall.SetValue("UninstallString", "\"" + Path.Combine(dir, "uninstall.exe") + "\"");
				uninstall.SetValue("NoModify", 1, RegistryValueKind.DWord);
				uninstall.SetValue("NoRepair", 1, RegistryValueKind.DWord);
				uninstall.SetValue("EstimatedSize", (int)(meta.PayloadBytes / 1024), RegistryValueKind.DWord);
			}
		}

		private static void Uninstall(Meta meta, bool silent)
		{
			string dir = meta.TargetDir;
			StopShell(dir);

			string shortcut = Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
				"Microsoft", "Windows", "Start Menu", "Programs", meta.AppName + ".lnk");
			try { if (File.Exists(shortcut)) File.Delete(shortcut); } catch { }

			try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + meta.RegistryKey, false); } catch { }

			// The uninstaller lives inside the folder it removes, so the delete is
			// handed to a detached cmd that waits a moment and then takes the tree.
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

		private static void StopShell(string dir)
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
				catch { }
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
					catch { }
				}
			}
			return false;
		}
	}

	/// <summary>The name, registry key and version written into this installer.</summary>
	internal sealed class Meta
	{
		internal string AppName = "PCB";
		internal string RegistryKey = "PCB";
		internal string Version = "0.1.0";
		internal long PayloadBytes;

		internal string TargetDir
		{
			get
			{
				return Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"Programs", AppName);
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

	/// <summary>One window: progress while it extracts, then "open PCB" and close.</summary>
	internal sealed class InstallForm : Form
	{
		private readonly Meta meta;
		private readonly Label status;
		private readonly ProgressBar bar;
		private readonly Button action;
		private readonly CheckBox launch;
		private bool done;
		private string error;

		internal InstallForm(Meta meta)
		{
			this.meta = meta;
			Text = "安装 " + meta.AppName + " " + meta.Version;
			FormBorderStyle = FormBorderStyle.FixedDialog;
			StartPosition = FormStartPosition.CenterScreen;
			MaximizeBox = false;
			MinimizeBox = false;
			ClientSize = new Size(460, 176);
			Font = new Font("Segoe UI", 9f);

			status = new Label
			{
				Text = "正在安装到 " + meta.TargetDir,
				AutoSize = false,
				Bounds = new Rectangle(20, 18, 420, 40),
			};
			bar = new ProgressBar { Bounds = new Rectangle(20, 62, 420, 14), Minimum = 0, Maximum = 100 };
			launch = new CheckBox
			{
				Text = "安装完成后打开 " + meta.AppName,
				Checked = true,
				Visible = false,
				Bounds = new Rectangle(20, 90, 420, 22),
			};
			action = new Button { Text = "取消", Bounds = new Rectangle(356, 126, 84, 28) };
			action.Click += delegate { if (!done) Close(); else Finish(); };

			Controls.Add(status);
			Controls.Add(bar);
			Controls.Add(launch);
			Controls.Add(action);
			Shown += delegate { ThreadPool.QueueUserWorkItem(_ => Work()); };
		}

		private void Work()
		{
			Progress<int> progress = new Progress<int>(value =>
			{
				if (IsDisposed) return;
				bar.Value = Math.Min(100, Math.Max(0, value));
			});
			error = Program.Install(meta, progress);
			Invoke((MethodInvoker)delegate
			{
				done = true;
				if (error != null)
				{
					status.Text = error;
					status.ForeColor = Color.Firebrick;
					action.Text = "关闭";
					return;
				}

				bar.Value = 100;
				status.Text = meta.AppName + " 已安装。";
				action.Text = "完成";
				launch.Visible = true;
				if (!Program.WebView2Installed())
				{
					status.Text = meta.AppName + " 已安装。这台机器还没有 WebView2 运行时，打开窗口前需要先装它。";
					launch.Checked = false;
					launch.Text = "打开 WebView2 下载页";
				}
			});
		}

		private void Finish()
		{
			if (launch.Visible && launch.Checked)
			{
				if (Program.WebView2Installed())
				{
					Process.Start(new ProcessStartInfo(Path.Combine(meta.TargetDir, "PCBWindow.exe")) { WorkingDirectory = meta.TargetDir });
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
