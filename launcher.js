function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

var app = Application.currentApplication();
app.includeStandardAdditions = true;

var projectPath = "/Users/olivedf/Documents/Trading Dashboard";
var command =
  "cd " +
  shellQuote(projectPath) +
  "; chmod +x launch-dashboard.sh stop-dashboard.sh; " +
  shellQuote(projectPath + "/launch-dashboard.sh");

app.doShellScript(command);
