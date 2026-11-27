using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace PcbWindow
{
	/// <summary>
	/// Ties the window, the tray icon and the local server together: one window
	/// for the life of the process, a tray that can bring it back, and a node
	/// process this program owns only when it had to start one.
	/// </summary>
	internal sealed class ShellContext : ApplicationContext
	{
		private readonly ShellForm form;
		private readonly NotifyIcon tray;
		private readonly ServerHost host;
		private readonly EventWaitHandle showSignal;
		private readonly EventWaitHandle quitSignal;
		private readonly Thread listener;
		private bool exiting;

		public ShellContext(string root, EventWaitHandle showSignal, EventWaitHandle quitSignal)
		{
			this.showSignal = showSignal;
			this.quitSignal = quitSignal;
			host = new ServerHost(root);

			form = new ShellForm();
			form.Show();

			tray = new NotifyIcon();
			tray.Icon = form.Icon;
			tray.Text = "PCB";
			tray.Visible = true;
			ContextMenuStrip menu = new ContextMenuStrip();
			menu.Items.Add("打开", null, delegate { Diagnostics.Log("tray open"); ShowShell(); });
			menu.Items.Add("退出", null, delegate { ExitApp(); });
			tray.ContextMenuStrip = menu;
			tray.DoubleClick += delegate { Diagnostics.Log("tray double-click"); ShowShell(); };

			listener = new Thread(WatchForShow);
			listener.IsBackground = true;
			listener.Name = "pcb-show-signal";
			listener.Start();

			// The service can die while the window is up. Without this the page keeps
			// its last frame and every button silently fails.
			host.Restarted += delegate
			{
				Diagnostics.Log("service restarted");
				Reload();
			};
			host.GaveUp += delegate
			{
				Diagnostics.Log("service gave up");
				if (form.IsHandleCreated)
				{
					try
					{
						form.BeginInvoke((Action)delegate
						{
							form.ShowMessage("本机服务反复退出，窗口已经不能用了。重开 PCB 会重新起服务；日志：" + Diagnostics.FilePath);
						});
					}
					catch
					{
						// the window may be gone by the time this lands
					}
				}
			};

			Task notifier = StartServiceAsync();
		}

		/// <summary>Marshalled to the UI thread: the page must reload to reach the new service.</summary>
		private void Reload()
		{
			if (!form.IsHandleCreated) return;
			try
			{
				form.BeginInvoke((Action)delegate { form.ReloadService(); });
			}
			catch
			{
				// the window may be gone by the time this lands
			}
		}

		private async Task StartServiceAsync()
		{
			string problem = await host.EnsureAsync();
			if (problem != null)
			{
				form.ShowMessage(problem);
				return;
			}
			form.LoadService();
		}

		/// <summary>Tray "open", a second instance, and the window itself all land here.</summary>
		private void ShowShell()
		{
			if (exiting || form.IsDisposed) { Diagnostics.Log("show ignored exiting=" + exiting + " disposed=" + form.IsDisposed); return; }
			if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
			form.Show();
			form.Activate();
			form.BringToFront();
			Diagnostics.Log("window shown");
		}

		private void WatchForShow()
		{
			while (!exiting)
			{
				WaitHandle[] signals = new WaitHandle[] { showSignal, quitSignal };
				int which = WaitHandle.WaitAny(signals, 500);
				if (which == WaitHandle.WaitTimeout) continue;
				if (exiting) return;
				try
				{
					if (which == 0) form.BeginInvoke(new Action(ShowShell));
					else form.BeginInvoke(new Action(ExitApp));
				}
				catch (Exception)
				{
					// shutting down
				}
			}
		}

		/// <summary>Tray "quit": stop the node this program started, then leave.</summary>
		private void ExitApp()
		{
			if (exiting) return;
			exiting = true;
			Diagnostics.Log("tray exit requested");

			form.Exiting = true;
			try { tray.Visible = false; } catch { }

			// Let the menu strip close first: tearing the window down inside its own
			// click handler is what used to leave a disposed form behind.
			try
			{
				form.BeginInvoke(new Action(ShutDown));
			}
			catch (Exception)
			{
				ShutDown();
			}
		}

		/// <summary>Runs on the UI thread after the menu has closed.</summary>
		private void ShutDown()
		{
			// Runs the whole node shutdown (SIGINT, about three seconds at most)
			// before falling back to killing it. A server we did not start stays.
			host.Stop();

			try { if (!form.IsDisposed) form.Close(); } catch (Exception error) { Diagnostics.Log("close failed: " + error.Message); }
			try { tray.Dispose(); } catch { }
			Diagnostics.Log("window program exiting");
			ExitThread();
		}

		protected override void Dispose(bool disposing)
		{
			if (disposing)
			{
				exiting = true;
				try { tray.Visible = false; tray.Dispose(); } catch { }
				try { if (!form.IsDisposed) form.Dispose(); } catch { }
				try { host.Dispose(); } catch { }
				try { showSignal.Close(); } catch { }
			}
			base.Dispose(disposing);
		}
	}
}
