using System;
using System.Runtime.InteropServices;

namespace PcbWindow
{
	/// <summary>The three console calls needed to stop node the way a Ctrl+C would.</summary>
	internal static class Native
	{
		public const uint CtrlCEvent = 0;

		[DllImport("kernel32.dll", SetLastError = true)]
		public static extern bool AttachConsole(uint processId);

		[DllImport("kernel32.dll", SetLastError = true)]
		public static extern bool FreeConsole();

		[DllImport("kernel32.dll", SetLastError = true)]
		public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroupId);

		[DllImport("kernel32.dll", SetLastError = true)]
		public static extern bool SetConsoleCtrlHandler(ConsoleCtrlHandler handler, bool add);

		[DllImport("user32.dll", CharSet = CharSet.Unicode)]
		public static extern bool DestroyIcon(IntPtr handle);

		public delegate bool ConsoleCtrlHandler(uint ctrlType);

		/// <summary>
		/// While our own process is briefly attached to node's console we receive the
		/// same Ctrl+C. Answering true keeps us alive; node still gets its SIGINT.
		/// </summary>
		public static readonly ConsoleCtrlHandler IgnoreCtrlC = delegate(uint ctrlType) { return true; };
	}
}
