# Cockpit's one-line install. Open PowerShell (Windows key, type PowerShell, Enter) and paste:
#
#   irm https://raw.githubusercontent.com/Zukizuk/cockpit/main/scripts/package/get.ps1 | iex
#
# It downloads the latest release's zip, checks it against the SHA-256 GitHub publishes for it, unzips it to a temp
# folder and runs the same installer as Install.cmd from there. Files fetched this way carry no "came from the
# internet" mark, so Windows doesn't stop to look each one up (SmartScreen) as it does for a zip downloaded in the
# browser, and there's no slow unzip in Explorer. Running it again updates Cockpit, as Install.cmd does.
& {
  $ErrorActionPreference = 'Stop'
  # Windows PowerShell's progress bar makes a download many times slower
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  Write-Host ''
  Write-Host 'Finding the latest Cockpit...'
  $release = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/Zukizuk/cockpit/releases/latest'
  $asset = $release.assets | Where-Object { $_.name -like 'Cockpit-*-win-x64.zip' } | Select-Object -First 1
  if (-not $asset) { throw "The latest release ($($release.tag_name)) has no Windows zip. Nothing was installed." }
  $sha256 = if ("$($asset.digest)" -match '^sha256:([0-9a-f]{64})$') { $Matches[1] } else { '' }

  $work = Join-Path $env:TEMP ('cockpit-setup-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force $work | Out-Null
  try {
    Write-Host "Downloading Cockpit $($release.tag_name) ($([math]::Round($asset.size / 1MB)) MB)..."
    $zip = Join-Path $work $asset.name
    Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $zip
    if ($sha256 -and (Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha256) {
      throw "The download doesn't match the release (checksum). Nothing was installed; try again."
    }
    Write-Host 'Unzipping...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $work)
    # its own process, so it runs whatever this PC's script policy is (as Install.cmd does)
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $work 'Cockpit\install.ps1')
    if ($LASTEXITCODE) { throw "The installer stopped (exit code $LASTEXITCODE)." }
  }
  finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
