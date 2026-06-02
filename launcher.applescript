on run
	set projectPath to "/Users/olivedf/Documents/Trading Dashboard"
	set projectPathQuoted to quoted form of projectPath
	set launchScript to quoted form of (projectPath & "/launch-dashboard.sh")
	set launchCommand to "cd " & projectPathQuoted & "; chmod +x launch-dashboard.sh stop-dashboard.sh; " & launchScript
	do shell script launchCommand
end run
