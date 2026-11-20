using System;
using System.Runtime.InteropServices;

namespace PcbWindow
{
	/// <summary>
	/// A job object with kill-on-close. The node process the shell starts lives
	/// inside it, so a crash of the shell cannot leave a server behind holding
	/// 127.0.0.1:7777. A plain "closing the window" does not touch it: the shell
	/// process is still alive, so the job is still alive.
	/// </summary>
	internal static class Job
	{
		private const int JobObjectExtendedLimitInformation = 9;
		private const uint KillOnJobClose = 0x2000;

		[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
		private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

		[DllImport("kernel32.dll", SetLastError = true)]
		private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

		[DllImport("kernel32.dll", SetLastError = true)]
		private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, int length);

		[DllImport("kernel32.dll", SetLastError = true)]
		private static extern bool CloseHandle(IntPtr handle);

		[StructLayout(LayoutKind.Sequential)]
		private struct BasicLimits
		{
			public long PerProcessUserTimeLimit;
			public long PerJobUserTimeLimit;
			public uint LimitFlags;
			public UIntPtr MinimumWorkingSetSize;
			public UIntPtr MaximumWorkingSetSize;
			public uint ActiveProcessLimit;
			public UIntPtr Affinity;
			public uint PriorityClass;
			public uint SchedulingClass;
		}

		[StructLayout(LayoutKind.Sequential)]
		private struct IoCounters
		{
			public ulong ReadOperationCount;
			public ulong WriteOperationCount;
			public ulong OtherOperationCount;
			public ulong ReadTransferCount;
			public ulong WriteTransferCount;
			public ulong OtherTransferCount;
		}

		[StructLayout(LayoutKind.Sequential)]
		private struct ExtendedLimits
		{
			public BasicLimits BasicLimitInformation;
			public IoCounters IoInfo;
			public UIntPtr ProcessMemoryLimit;
			public UIntPtr JobMemoryLimit;
			public UIntPtr PeakProcessMemoryUsed;
			public UIntPtr PeakJobMemoryUsed;
		}

		/// <summary>Returns a job handle (0 when the machine refuses), and puts the child in it.</summary>
		public static IntPtr Attach(IntPtr process)
		{
			IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
			if (job == IntPtr.Zero) return IntPtr.Zero;

			ExtendedLimits limits = new ExtendedLimits();
			limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
			int size = Marshal.SizeOf(typeof(ExtendedLimits));
			IntPtr buffer = Marshal.AllocHGlobal(size);
			try
			{
				Marshal.StructureToPtr(limits, buffer, false);
				if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, size))
				{
					CloseHandle(job);
					return IntPtr.Zero;
				}
			}
			finally
			{
				Marshal.FreeHGlobal(buffer);
			}

			if (!AssignProcessToJobObject(job, process))
			{
				CloseHandle(job);
				return IntPtr.Zero;
			}
			return job;
		}

		public static void Release(IntPtr job)
		{
			if (job == IntPtr.Zero) return;
			CloseHandle(job);
		}
	}
}
