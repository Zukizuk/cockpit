' Opens Cockpit: starts its server if it isn't running (no window), waits until it answers, then opens Cockpit
' in its own Edge window. The Start menu's "Cockpit" shortcut runs this, and so does Ctrl+Alt+K until Cockpit is
' installed as an app from Edge.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:4790/"

Function Up()
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 500, 500, 500, 500
  http.open "GET", url, False
  http.send
  Up = (Err.Number = 0 And http.status = 200)
End Function

If Not Up() Then
  sh.Run "wscript.exe """ & here & "\start-hidden.vbs""", 0, False
  For i = 1 To 40
    WScript.Sleep 250
    If Up() Then Exit For
  Next
End If

edge = ""
On Error Resume Next
edge = sh.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe\")
On Error GoTo 0
If edge = "" Then edge = "msedge"
sh.Run """" & edge & """ --app=" & url, 1, False
