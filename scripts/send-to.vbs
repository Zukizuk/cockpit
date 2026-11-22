' Explorer's Send to > Cockpit: puts the files and folders sent on the board. Each one is left in Cockpit's inbox
' (as Claude Code's Outputs hook does), so nothing is lost when Cockpit isn't running; then Cockpit comes up: an open
' window is brought forward, otherwise open.vbs starts the server if needed and opens one.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count = 0 Then WScript.Quit 0

data = sh.ExpandEnvironmentStrings("%COCKPIT_DATA%")
If data = "%COCKPIT_DATA%" Or data = "" Then data = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.cockpit"
inbox = data & "\inbox"
If Not fso.FolderExists(data) Then fso.CreateFolder data
If Not fso.FolderExists(inbox) Then fso.CreateFolder inbox

' A JSON string kept to plain ASCII (the file is written as ANSI; Cockpit reads UTF-8): anything else as \uXXXX
Function JsonText(s)
  Dim out, i, c, code
  out = ""
  For i = 1 To Len(s)
    c = Mid(s, i, 1)
    code = AscW(c)
    If code < 0 Then code = code + 65536
    If c = "\" Then
      out = out & "\\"
    ElseIf c = """" Then
      out = out & "\"""
    ElseIf code < 32 Or code > 126 Then
      out = out & "\u" & Right("000" & Hex(code), 4)
    Else
      out = out & c
    End If
  Next
  JsonText = """" & out & """"
End Function

Randomize
For i = 0 To WScript.Arguments.Count - 1
  name = "sendto-" & Year(Now) & Right("0" & Month(Now), 2) & Right("0" & Day(Now), 2) & "-" & Int(Timer * 1000) & "-" & i & "-" & Int(Rnd * 100000)
  ' written beside, then renamed: Cockpit only ever sees a whole file
  Set f = fso.CreateTextFile(inbox & "\" & name & ".tmp", True, False)
  f.Write "{""path"":" & JsonText(WScript.Arguments(i)) & ",""from"":""Send to""}"
  f.Close
  fso.MoveFile inbox & "\" & name & ".tmp", inbox & "\" & name & ".json"
Next

' How many Cockpit windows are open (0 if the server isn't up)
Function Windows()
  On Error Resume Next
  Windows = -1
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 500, 500, 500, 500
  http.open "GET", "http://127.0.0.1:4790/api/health", False
  http.send
  If Err.Number <> 0 Or http.status <> 200 Then Exit Function
  Set re = New RegExp
  re.Pattern = """windows"":(\d+)"
  Set m = re.Execute(http.responseText)
  If m.Count > 0 Then Windows = CInt(m(0).SubMatches(0)) Else Windows = 0
End Function

If Windows() > 0 Then
  ' its window is titled "Cockpit"; if it can't be found, the cards are on the board anyway
  sh.AppActivate "Cockpit"
Else
  sh.Run "wscript.exe """ & here & "\open.vbs""", 0, False
End If
