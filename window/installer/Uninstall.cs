using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PcbUninstall
{
	/// <summary>
	/// The uninstaller the installer drops into its own folder (about 15 KB, not a
	/// second copy of the payload). It reads install-meta.txt next to itself, stops
	/// the shell that belongs to this folder, removes both shortcuts, the bin entry
	/// on the user PATH and the HKCU uninstall entry, then hands the remaining
	/// folder to a detached cmd — a running exe cannot delete its own directory.
	///
	/// %USERPROFILE%\.pcb and omp's own sessions live outside the install folder and
	/// are never touched here.
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

			string startMenu = Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
				"Microsoft", "Windows", "Start Menu", "Programs", appName + ".lnk");
			try { if (File.Exists(startMenu)) File.Delete(startMenu); } catch { }

			string desktop = Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.Desktop), appName + ".lnk");
			try { if (File.Exists(desktop)) File.Delete(desktop); } catch { }

			RemoveUserPath(Path.Combine(dir, "bin"));

			string key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + appName.Replace(" ", "-");
			try { Registry.CurrentUser.DeleteSubKeyTree(key, false); } catch { }

			Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"" + dir + "\"")
			{
				CreateNoWindow = true,
				UseShellExecute = false,
			});

			if (!silent) MessageBox.Show(appName + " 已卸载。", appName, MessageBoxButtons.OK, MessageBoxIcon.Information);
		}

		/// <summary>Drops exactly the bin\ entry the installer added; other PATH entries stay.</summary>
		private static void RemoveUserPath(string binDir)
		{
			try
			{
				string current = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User);
				if (current == null) return;

				bool found = false;
				string next = "";
				foreach (string part in current.Split(';'))
				{
					string trimmed = part.Trim();
					if (trimmed.Length == 0) continue;
					if (string.Equals(trimmed.TrimEnd('\\'), binDir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
					{
						found = true;
						continue;
					}
					next = next.Length == 0 ? trimmed : next + ";" + trimmed;
				}
				if (!found) return;

				Environment.SetEnvironmentVariable("Path", next, EnvironmentVariableTarget.User);
				UIntPtr ignored;
				SendMessageTimeout(new IntPtr(0xffff), 0x1A, UIntPtr.Zero, "Environment", 0x0002, 5000, out ignored);
			}
			catch
			{
			}
		}

		[DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
		private static extern IntPtr SendMessageTimeout(
			IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);

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
