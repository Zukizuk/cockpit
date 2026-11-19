' Starts Cockpit's server with no window. Used by the Startup shortcut, the Start menu launcher (open.vbs) and the
' Cockpit helper. If the server is already running, the new copy notices and exits.
' An installed copy brings its own Node (runtime\node.exe beside the app folder); a clone uses the Node on PATH.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = fso.BuildPath(fso.GetParentFolderName(root), "runtime\node.exe")
If Not fso.FileExists(node) Then node = "node"
sh.CurrentDirectory = root
sh.Run """" & node & """ """ & root & "\server\index.js""", 0, False
