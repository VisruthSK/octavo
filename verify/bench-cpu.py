import ctypes
import json
import subprocess
import sys
from ctypes import wintypes


class Accounting(ctypes.Structure):
    _fields_ = [
        ("user", ctypes.c_longlong),
        ("kernel", ctypes.c_longlong),
        ("period_user", ctypes.c_longlong),
        ("period_kernel", ctypes.c_longlong),
        ("page_faults", wintypes.DWORD),
        ("total_processes", wintypes.DWORD),
        ("active_processes", wintypes.DWORD),
        ("terminated_processes", wintypes.DWORD),
    ]


kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
kernel.CreateJobObjectW.restype = wintypes.HANDLE
kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
resume = ctypes.WinDLL("ntdll").NtResumeProcess
resume.argtypes = [wintypes.HANDLE]
job = kernel.CreateJobObjectW(None, None)
if not job:
    raise ctypes.WinError(ctypes.get_last_error())
process = subprocess.Popen(sys.argv[1:], creationflags=4)
try:
    if not kernel.AssignProcessToJobObject(job, int(process._handle)):
        raise ctypes.WinError(ctypes.get_last_error())
    if resume(int(process._handle)):
        raise RuntimeError("could not resume benchmark")
    status = process.wait()
    accounting = Accounting()
    if not kernel.QueryInformationJobObject(job, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
        raise ctypes.WinError(ctypes.get_last_error())
    print(json.dumps({"treeUserSeconds": accounting.user / 1e7, "treeKernelSeconds": accounting.kernel / 1e7, "processes": accounting.total_processes}), flush=True)
    sys.exit(status)
finally:
    if process.poll() is None:
        process.kill()
    kernel.CloseHandle(job)
