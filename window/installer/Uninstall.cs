using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PcbUninstall
{
	/// <summary>
	/// The uninstaller the installer drops into its own folder (about 15 KB, not a
	/// second copy of the payload). It reads install-meta.txt next to itself, stops
	/// the shell that belongs to this folder, removes the shortcut and the HKCU
	/// uninstall entry, then hands the remaining folder to a detached cmd — a
	/// running exe cannot delete its own directory.
	/// </summary>
	internal static class Program
	{
		[STAThread]
		private static void Main(string[] args)
		{
			bool silent = Array.Exists(args, a => a.Equals("--silent", StringComparison.OrdinalIgnoreCase));
			string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
			string appName = "PCB";

			string meta = Path.Combine(dir, "install-meta.txt");
			if (File.Exists(meta))
			{
				foreach (string line in File.ReadAllLines(meta))
				{
					if (line.StartsWith("AppName=", StringComparison.Ordinal)) appName = line.Substring("AppName=".Length).Trim();
				}
			}

			StopShell(dir);

			string shortcut = Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
				"Microsoft", "Windows", "Start Menu", "Programs", appName + ".lnk");
			try { if (File.Exists(shortcut)) File.Delete(shortcut); } catch { }

			string key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + appName.Replace(" ", "-");
			try { Registry.CurrentUser.DeleteSubKeyTree(key, false); } catch { }

			Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"" + dir + "\"")
			{
				CreateNoWindow = true,
				UseShellExecute = false,
			});

			if (!silent) MessageBox.Show(appName + " 已卸载。", appName, MessageBoxButtons.OK, MessageBoxIcon.Information);
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
	}
}
