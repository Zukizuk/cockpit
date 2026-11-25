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
    Write-Host "Downloading Cockpit $($release.tag_name)..."
    $zip = Join-Path $work $asset.name
    # read in chunks and say how far it's got on one line, a few times a second (PowerShell's own progress bar is
    # what makes Invoke-WebRequest slow)
    $res = ([Net.HttpWebRequest]::Create($asset.browser_download_url)).GetResponse()
    $total = if ($res.ContentLength -gt 0) { $res.ContentLength } else { $asset.size }
    $in = $res.GetResponseStream()
    $out = [IO.File]::Create($zip)
    try {
      $buf = New-Object byte[] 262144
      $got = 0
      $clock = [Diagnostics.Stopwatch]::StartNew()
      $shown = -1000
      $say = {
        $mb = [math]::Round($got / 1MB)
        $of = [math]::Round($total / 1MB)
        $pct = if ($total) { [math]::Floor(100 * $got / $total) } else { 0 }
        $secs = [math]::Max(0.001, $clock.Elapsed.TotalSeconds)
        $speed = [math]::Round($got / 1MB / $secs, 1)
        Write-Host -NoNewline ("`r  {0} of {1} MB ({2}%), {3} MB/s    " -f $mb, $of, $pct, $speed)
      }
      while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
        $out.Write($buf, 0, $n)
        $got += $n
        if ($clock.ElapsedMilliseconds - $shown -ge 250) {
          & $say
          $shown = $clock.ElapsedMilliseconds
        }
      }
      & $say
      Write-Host ''
    }
    finally {
      $out.Close()
      $in.Close()
      $res.Close()
    }
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
