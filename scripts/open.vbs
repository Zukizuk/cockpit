' Opens Cockpit: starts its server if it isn't running (no window), waits until it answers, then opens Cockpit
' in its own Edge window (the default browser if there's no Edge). The Start menu's "Cockpit" shortcut runs this,
' and so does Ctrl+Alt+K until Cockpit is installed as an app from Edge. If the server can't start, it says so.
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
  For i = 1 To 60
    WScript.Sleep 250
    If Up() Then Exit For
  Next
  If Not Up() Then
    ' most often another program already uses Cockpit's port; the log says what happened
    MsgBox "Cockpit couldn't start." & vbCrLf & vbCrLf & "Another program may be using port 4790. The details are in " & _
      sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.cockpit\server.log", vbExclamation, "Cockpit"
    WScript.Quit 1
  End If
End If

edge = ""
On Error Resume Next
edge = sh.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe\")
If edge = "" Then edge = sh.RegRead("HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe\")
On Error GoTo 0
If edge <> "" And fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=" & url, 1, False
Else
  sh.Run url, 1, False
End If
