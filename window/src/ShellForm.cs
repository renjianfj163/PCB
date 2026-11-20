using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PcbWindow
{
	/// <summary>
	/// The whole window: title "PCB", the page, and nothing else. No address bar,
	/// no tabs, no bookmarks, no File/Edit/View menu — the page brings its own
	/// top bar, so a second one would only be in the way.
	/// </summary>
	internal sealed class ShellForm : Form
	{
		private readonly WebView2 web = new WebView2();
		private readonly Label message = new Label();
		private readonly Icon shellIcon;
		private IntPtr iconHandle = IntPtr.Zero;
		private bool sized;

		/// <summary>Set right before the program really exits, so closing is final.</summary>
		public bool Exiting { get; set; }

		public ShellForm()
		{
			Text = "PCB";
			AutoScaleMode = AutoScaleMode.None;
			ClientSize = new Size(1440, 900);
			MinimumSize = new Size(960, 600);
			StartPosition = FormStartPosition.CenterScreen;
			FormBorderStyle = FormBorderStyle.Sizable;
			MaximizeBox = true;
			MinimizeBox = true;
			ShowIcon = true;
			shellIcon = BuildIcon();
			Icon = shellIcon;

			web.Dock = DockStyle.Fill;
			web.Visible = false;

			message.Dock = DockStyle.Fill;
			message.TextAlign = ContentAlignment.MiddleCenter;
			message.AutoSize = false;
			message.Padding = new Padding(32);
			message.BackColor = Color.FromArgb(250, 249, 247);
			message.ForeColor = Color.FromArgb(23, 23, 26);
			message.Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Regular, GraphicsUnit.Point);
			message.Text = "正在启动本机服务…";
			message.Visible = true;

			Controls.Add(web);
			Controls.Add(message);
		}

		/// <summary>
		/// 1440×900 is the page's layout size, so the window is sized in device
		/// pixels for the monitor it opens on; a 150% screen gets a 2160×1350
		/// window showing the same three columns at full resolution.
		/// </summary>
		private void ApplyInitialSize()
		{
			using (Graphics graphics = CreateGraphics())
			{
				float scale = graphics.DpiX / 96f;
				if (scale > 1.01f || scale < 0.99f)
				{
					ClientSize = new Size(
						(int)Math.Round(1440 * scale),
						(int)Math.Round(900 * scale));
				}
			}
		}

		/// <summary>Load the page once the port answers; failures stay one sentence.</summary>
		public async void LoadService()
		{
			string userData = UserDataFolder();
			try
			{
				CoreWebView2Environment environment =
					await CoreWebView2Environment.CreateAsync(null, userData, null);
				await web.EnsureCoreWebView2Async(environment);
				web.CoreWebView2.Settings.IsStatusBarEnabled = false;
				web.CoreWebView2.Settings.AreDevToolsEnabled = true;
				web.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
				web.CoreWebView2.Navigate(ServerHost.Url);
			}
			catch (Exception)
			{
				ShowMessage("这个窗口起不了 WebView2，页面打不开（本机的 WebView2 运行库可能没装）。");
			}
		}

		private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
		{
			if (e.IsSuccess)
			{
				message.Visible = false;
				web.Visible = true;
				return;
			}
			ShowMessage("页面没有打开：127.0.0.1:7777 没有响应。");
		}

		public void ShowMessage(string text)
		{
			message.Text = text;
			message.Visible = true;
			web.Visible = false;
		}

		public static string UserDataFolder()
		{
			string baseDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
			return System.IO.Path.Combine(baseDir, "PCB", "webview2");
		}

		protected override void OnHandleCreated(EventArgs e)
		{
			base.OnHandleCreated(e);
			if (!sized) { sized = true; ApplyInitialSize(); }
		}

		/// <summary>
		/// Closing the window hides it: the process, the port and the tray stay,
		/// because the scheduled tasks live in the node process behind them. Only
		/// a real exit (tray "quit") or a Windows shutdown lets the close through.
		/// </summary>
		protected override void OnFormClosing(FormClosingEventArgs e)
		{
			Diagnostics.Log("closing reason=" + e.CloseReason + " exiting=" + Exiting);
			if (!Exiting
				&& e.CloseReason != CloseReason.WindowsShutDown
				&& e.CloseReason != CloseReason.ApplicationExitCall
				&& e.CloseReason != CloseReason.TaskManagerClosing)
			{
				e.Cancel = true;
				Hide();
				Diagnostics.Log("window hidden");
				return;
			}
			base.OnFormClosing(e);
		}

		protected override void Dispose(bool disposing)
		{
			if (disposing)
			{
				try { if (web.CoreWebView2 != null) web.CoreWebView2.NavigationCompleted -= OnNavigationCompleted; } catch { }
				try { web.Dispose(); } catch { }
			}
			base.Dispose(disposing);
			if (iconHandle != IntPtr.Zero)
			{
				Native.DestroyIcon(iconHandle);
				iconHandle = IntPtr.Zero;
			}
		}

		/// <summary>A 32px round badge with the product name; no asset file to ship.</summary>
		private Icon BuildIcon()
		{
			using (Bitmap bitmap = new Bitmap(32, 32))
			{
				using (Graphics graphics = Graphics.FromImage(bitmap))
				{
					graphics.SmoothingMode = SmoothingMode.AntiAlias;
					graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
					graphics.Clear(Color.Transparent);
					using (SolidBrush background = new SolidBrush(Color.FromArgb(31, 111, 235)))
					{
						graphics.FillEllipse(background, 0, 0, 31, 31);
					}
					using (Font font = new Font("Segoe UI", 17f, FontStyle.Bold, GraphicsUnit.Pixel))
					using (SolidBrush ink = new SolidBrush(Color.White))
					using (StringFormat format = new StringFormat())
					{
						format.Alignment = StringAlignment.Center;
						format.LineAlignment = StringAlignment.Center;
						graphics.DrawString("P", font, ink, new RectangleF(0, 0, 32, 32), format);
					}
				}
				iconHandle = bitmap.GetHicon();
			}
			return Icon.FromHandle(iconHandle);
		}
	}
}
