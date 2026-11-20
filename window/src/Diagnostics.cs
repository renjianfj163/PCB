using System;
using System.IO;

namespace PcbWindow
{
	/// <summary>
	/// One append-only line per event, next to the WebView2 data. A shell that
	/// fails silently is worse than one that fails loudly, but the window must
	/// never show a stack: it logs, and the window says one sentence.
	/// </summary>
	internal static class Diagnostics
	{
		private static readonly object Gate = new object();

		public static string FilePath
		{
			get
			{
				string baseDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
				return Path.Combine(baseDir, "PCB", "window.log");
			}
		}

		public static void Log(string message)
		{
			try
			{
				string path = FilePath;
				string dir = Path.GetDirectoryName(path);
				if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
				lock (Gate)
				{
					File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + message + Environment.NewLine);
				}
			}
			catch
			{
				// logging must never be the reason the shell dies
			}
		}
	}
}
