using System;
using System.Threading;
using System.Windows.Forms;

namespace PcbWindow
{
	/// <summary>
	/// One window program per desktop session. A second copy asks the first to
	/// show its window and exits without touching the server.
	/// </summary>
	internal static class Program
	{
		private const string MutexName = "Local\\PCB.Window.Instance";
		private const string ShowEventName = "Local\\PCB.Window.Show";
		private const string QuitEventName = "Local\\PCB.Window.Quit";

		[STAThread]
		private static void Main(string[] args)
		{
			if (args != null && Array.IndexOf(args, "--quit") >= 0)
			{
				// Asked by a shortcut, an installer or a script: let the running copy exit
				// through its own tray-quit path, then leave.
				Environment.Exit(Signal("Local\\PCB.Window.Quit") ? 0 : 1);
				return;
			}

			bool created;
			using (Mutex mutex = new Mutex(true, MutexName, out created))
			{
				if (!created)
				{
					SignalExisting();
					return;
				}

				try
				{
					Application.EnableVisualStyles();
					Application.SetCompatibleTextRenderingDefault(false);
					Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
					// Sending Ctrl+C to the node console must never take this process with it.
					Native.SetConsoleCtrlHandler(Native.IgnoreCtrlC, true);
					Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs failure)
					{
						Diagnostics.Log("ui exception: " + failure.Exception);
					};
					AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs failure)
					{
						Diagnostics.Log("fatal: " + failure.ExceptionObject);
					};
					Diagnostics.Log("window program started");

					using (EventWaitHandle showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName))
					using (EventWaitHandle quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName))
					using (ShellContext context = new ShellContext(ServerHost.FindRoot(), showSignal, quitSignal))
					{
						Application.Run(context);
					}
				}
				finally
				{
					try { mutex.ReleaseMutex(); } catch { }
				}
			}
		}

		/// <summary>Sets a named signal of the running copy; false when nothing is listening.</summary>
		private static bool Signal(string name)
		{
			DateTime deadline = DateTime.UtcNow.AddSeconds(3);
			while (DateTime.UtcNow < deadline)
			{
				try
				{
					using (EventWaitHandle handle = EventWaitHandle.OpenExisting(name))
					{
						handle.Set();
						return true;
					}
				}
				catch (WaitHandleCannotBeOpenedException)
				{
					Thread.Sleep(100);
				}
			}
			return false;
		}

		/// <summary>The first copy may still be creating its event; give it a moment.</summary>
		private static void SignalExisting()
		{
			DateTime deadline = DateTime.UtcNow.AddSeconds(3);
			while (DateTime.UtcNow < deadline)
			{
				try
				{
					using (EventWaitHandle show = EventWaitHandle.OpenExisting(ShowEventName))
					{
						show.Set();
						return;
					}
				}
				catch (WaitHandleCannotBeOpenedException)
				{
					Thread.Sleep(100);
				}
				catch (Exception)
				{
					return;
				}
			}
		}
	}
}
