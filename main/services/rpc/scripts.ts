export const HOOK_PS_CMD = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$script:browserProcs=@('chrome','firefox','msedge','opera','brave','vivaldi')
$script:urlPattern='^(https?://[^\\s]+|[a-zA-Z0-9][a-zA-Z0-9.-]*\\.[a-zA-Z]{2,}(/[^\\s]*)?)$'
function Get-BrowserUrl([IntPtr]$h) {
  try {
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
    if (-not $root) { return '' }
    $walker=[System.Windows.Automation.TreeWalker]::ContentViewWalker
    $stack=New-Object System.Collections.Generic.Stack[System.Windows.Automation.AutomationElement]
    $stack.Push($root)
    $visited=0
    while ($stack.Count -gt 0 -and $visited -lt 600) {
      $node=$stack.Pop()
      $visited++
      try {
        if ($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit) {
          $vp=$null
          if ($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
            $val=([System.Windows.Automation.ValuePattern]$vp).Current.Value
            if ($val -and $val -match $script:urlPattern) { return $val.Trim() }
          }
        }
      } catch {}
      try {
        $child=$walker.GetFirstChild($node)
        while ($child) {
          $stack.Push($child)
          $child=$walker.GetNextSibling($child)
        }
      } catch {}
    }
  } catch {}
  return ''
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W32H {
    public delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
}
"@
$EVENT_SYSTEM_FOREGROUND=0x0003
$EVENT_OBJECT_NAMECHANGE=0x800C
$WINEVENT_OUTOFCONTEXT=0x0000
$OBJID_WINDOW=0
$script:fg=[W32H]::GetForegroundWindow()
$script:last=''
function Emit-Foreground([IntPtr]$h, [bool]$force) {
  if ($h -eq [IntPtr]::Zero) { return }
  $procId=0
  [W32H]::GetWindowThreadProcessId($h,[ref]$procId)|Out-Null
  if ($procId -eq 0) { return }
  $proc=Get-Process -Id $procId -EA SilentlyContinue
  if (-not $proc) { return }
  $cap=[W32H]::GetWindowTextLength($h)+1
  $sb=[System.Text.StringBuilder]::new($cap)
  [W32H]::GetWindowText($h,$sb,$cap)|Out-Null
  $title=$sb.ToString()
  if (-not $title) { $title=$proc.MainWindowTitle }
  $path=''
  try { $path=$proc.Path } catch {}
  $url=''
  if ($script:browserProcs -contains $proc.ProcessName.ToLower()) { $url=Get-BrowserUrl $h }
  $json=[pscustomobject]@{n=$proc.ProcessName;t=$title;p=$path;u=$url}|ConvertTo-Json -Compress
  if ($force -or $json -ne $script:last) {
    $script:last=$json
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
  }
}
$callback = {
  param($hWinEventHook,$eventType,$hwnd,$idObject,$idChild,$dwEventThread,$dwmsEventTime)
  if ($eventType -eq $EVENT_SYSTEM_FOREGROUND) {
    $script:fg=$hwnd
    # Window switches always emit, even when the JSON matches the previous one:
    # A -> (own app, filtered downstream) -> A must resurface A. Dedup here would
    # swallow it and the Node side could never know the user came back.
    Emit-Foreground $hwnd $true
  } elseif ($eventType -eq $EVENT_OBJECT_NAMECHANGE -and $idObject -eq $OBJID_WINDOW -and $hwnd -eq $script:fg) {
    # Title changes on the same window are noisy (progress %, cursor pos) — dedup.
    Emit-Foreground $hwnd $false
  }
}
$delegate=[W32H+WinEventDelegate]$callback
$hookFg=[W32H]::SetWinEventHook($EVENT_SYSTEM_FOREGROUND,$EVENT_SYSTEM_FOREGROUND,[IntPtr]::Zero,$delegate,0,0,$WINEVENT_OUTOFCONTEXT)
$hookName=[W32H]::SetWinEventHook($EVENT_OBJECT_NAMECHANGE,$EVENT_OBJECT_NAMECHANGE,[IntPtr]::Zero,$delegate,0,0,$WINEVENT_OUTOFCONTEXT)
Emit-Foreground $script:fg $true
# Parent watchdog: if the app dies without killing us (crash, force-kill, power loss of the
# shell) this process would pump messages forever. Exit as soon as the parent is gone.
# HasExited (on a Process object taken now) is true as soon as the parent is dead, even while
# some other handle keeps the dead process object alive — GetProcessById would still succeed.
$script:parentProc=$null
try { $script:parentProc=[System.Diagnostics.Process]::GetProcessById(__PARENT_PID__) } catch {}
$watchdog=New-Object System.Windows.Forms.Timer
$watchdog.Interval=3000
$watchdog.Add_Tick({
  if ($null -eq $script:parentProc -or $script:parentProc.HasExited) { [System.Windows.Forms.Application]::Exit() }
})
$watchdog.Start()
[System.Windows.Forms.Application]::Run()
`;

// ---------------------------------------------------------------------------
// Windows fallback — single-shot poll (used only if the event hook can't start,
// e.g. Add-Type blocked by a corporate policy). Same P/Invoke as before, just
// invoked on a timer instead of continuously.
// ---------------------------------------------------------------------------
export const PS_CMD = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$browserProcs=@('chrome','firefox','msedge','opera','brave','vivaldi')
$urlPattern='^(https?://[^\\s]+|[a-zA-Z0-9][a-zA-Z0-9.-]*\\.[a-zA-Z]{2,}(/[^\\s]*)?)$'
function Get-BrowserUrl([IntPtr]$h) {
  try {
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
    if (-not $root) { return '' }
    $walker=[System.Windows.Automation.TreeWalker]::ContentViewWalker
    $stack=New-Object System.Collections.Generic.Stack[System.Windows.Automation.AutomationElement]
    $stack.Push($root)
    $visited=0
    while ($stack.Count -gt 0 -and $visited -lt 600) {
      $node=$stack.Pop()
      $visited++
      try {
        if ($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit) {
          $vp=$null
          if ($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
            $val=([System.Windows.Automation.ValuePattern]$vp).Current.Value
            if ($val -and $val -match $urlPattern) { return $val.Trim() }
          }
        }
      } catch {}
      try {
        $child=$walker.GetFirstChild($node)
        while ($child) {
          $stack.Push($child)
          $child=$walker.GetNextSibling($child)
        }
      } catch {}
    }
  } catch {}
  return ''
}
$s='[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);'
$t=Add-Type -MemberDefinition $s -Name U32 -Namespace W -PassThru
$h=$t::GetForegroundWindow(); $p=0
$t::GetWindowThreadProcessId($h,[ref]$p)|Out-Null
$x=Get-Process -Id $p -EA SilentlyContinue
if($x){
$cap=$t::GetWindowTextLength($h)+1
$sb=[System.Text.StringBuilder]::new($cap)
$t::GetWindowText($h,$sb,$cap)|Out-Null
$title=$sb.ToString()
if(-not $title){$title=$x.MainWindowTitle}
$path=''
try{$path=$x.Path}catch{}
$url=''
if ($browserProcs -contains $x.ProcessName.ToLower()) { $url=Get-BrowserUrl $h }
[pscustomobject]@{n=$x.ProcessName;t=$title;p=$path;u=$url}|ConvertTo-Json -Compress
}`;

// ---------------------------------------------------------------------------
// macOS osascript — gets foreground process name + window title (+ active
// tab URL for browsers that expose one via AppleScript — Chromium-family
// and Safari; Firefox has no scripting dictionary for tab URLs, so it stays
// title-only).
// Returns "processName|windowTitle|url" on stdout (url segment may be empty)
// ---------------------------------------------------------------------------
export const MACOS_CMD = `
set pn to ""
set wt to ""
tell application "System Events"
  set fp to first application process whose frontmost is true
  set pn to name of fp
  try
    set wt to title of first window of fp
  end try
end tell
set urlStr to ""
try
  if pn is in {"Google Chrome", "Google Chrome Canary", "Microsoft Edge", "Brave Browser", "Vivaldi", "Opera"} then
    tell application pn to set urlStr to URL of active tab of front window
  else if pn is "Safari" then
    tell application "Safari" to set urlStr to URL of front document
  end if
end try
return pn & "|" & wt & "|" & urlStr`;

// ---------------------------------------------------------------------------
// Blocklist — processes we should never broadcast as activity
