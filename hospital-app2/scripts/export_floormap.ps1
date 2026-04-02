param(
  [int]$Floor = 0,
  [int]$Width = 880,
  [int]$Height = 420,
  [int]$Padding = 24,
  [double]$Zoom = 22,
  [string]$OutFile = ""
)

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$floorplanPath = Join-Path $root "assets\data\floorplan_c.json"
$nodesPath = Join-Path $root "assets\data\nodes_hospital.json"
$overridesPath = Join-Path $PSScriptRoot "floormap_override.json"

$doorIconPath = Join-Path $root "assets\icons\door.png"
$doorsIconPath = Join-Path $root "assets\icons\doors.png"
$stairsIconPath = Join-Path $root "assets\icons\stairs.png"
$elevatorIconPath = Join-Path $root "assets\icons\elevator.png"

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $OutFile = Join-Path $root ("exports\floor-{0}-map-{1}x{2}.png" -f $Floor, $Width, $Height)
}

$floorplan = Get-Content $floorplanPath -Raw | ConvertFrom-Json
$nodes = Get-Content $nodesPath -Raw | ConvertFrom-Json
$overridesJson = Get-Content $overridesPath -Raw | ConvertFrom-Json

$roleStyles = @{
  door = @{
    OffsetX = 12
    OffsetY = -10
    Rotate = 0
    SizeStops = @(@(18, 0.06), @(20, 0.10), @(22, 0.16), @(24, 0.16))
  }
  doors = @{
    OffsetX = 8
    OffsetY = 0
    Rotate = 0
    SizeStops = @(@(18, 0.01), @(20, 0.01), @(22, 0.06), @(24, 0.14))
  }
  stairs = @{
    OffsetX = 2
    OffsetY = -15
    Rotate = 0
    SizeStops = @(@(18, 0.00), @(20, 0.04), @(22, 0.08), @(24, 0.09))
  }
  elevator = @{
    OffsetX = -10
    OffsetY = 0
    Rotate = 0
    SizeStops = @(@(18, 0.01), @(20, 0.03), @(22, 0.07), @(24, 0.13))
  }
}

$iconMeta = @{
  door = @{
    Width = 164
    Height = 141
  }
  doors = @{
    Width = 471
    Height = 244
  }
  stairs = @{
    Width = 562
    Height = 563
  }
  elevator = @{
    Width = 422
    Height = 609
  }
}

function Get-Override([string]$floorKey, [string]$nodeId) {
  if (-not $overridesJson.PSObject.Properties.Name.Contains($floorKey)) { return $null }
  $floorObj = $overridesJson.$floorKey
  if (-not $floorObj.PSObject.Properties.Name.Contains($nodeId)) { return $null }
  return $floorObj.$nodeId
}

function Interpolate-Stops($stops, [double]$value) {
  if ($value -le $stops[0][0]) { return [double]$stops[0][1] }
  if ($value -ge $stops[-1][0]) { return [double]$stops[-1][1] }

  for ($i = 1; $i -lt $stops.Count; $i++) {
    $x1 = [double]$stops[$i - 1][0]
    $y1 = [double]$stops[$i - 1][1]
    $x2 = [double]$stops[$i][0]
    $y2 = [double]$stops[$i][1]
    if ($value -le $x2) {
      $t = ($value - $x1) / ($x2 - $x1)
      return $y1 + (($y2 - $y1) * $t)
    }
  }

  return [double]$stops[-1][1]
}

$floorplanFeatures = @($floorplan.features | Where-Object { $_.properties.floor -eq $Floor })
$nodeFeatures = @($nodes.features | Where-Object { $_.properties.floor -eq $Floor })

$allCoords = New-Object System.Collections.Generic.List[object]
foreach ($feature in $floorplanFeatures) {
  foreach ($polygon in $feature.geometry.coordinates) {
    foreach ($ring in $polygon) {
      foreach ($coord in $ring) {
        [void]$allCoords.Add($coord)
      }
    }
  }
}
foreach ($feature in $nodeFeatures) {
  [void]$allCoords.Add($feature.geometry.coordinates)
}

if ($allCoords.Count -eq 0) {
  throw "No features found for floor $Floor."
}

$minX = [double]::PositiveInfinity
$maxX = [double]::NegativeInfinity
$minY = [double]::PositiveInfinity
$maxY = [double]::NegativeInfinity

foreach ($coord in $allCoords) {
  $x = [double]$coord[0]
  $y = [double]$coord[1]
  if ($x -lt $minX) { $minX = $x }
  if ($x -gt $maxX) { $maxX = $x }
  if ($y -lt $minY) { $minY = $y }
  if ($y -gt $maxY) { $maxY = $y }
}

$dataWidth = [Math]::Max(1.0, $maxX - $minX)
$dataHeight = [Math]::Max(1.0, $maxY - $minY)
$usableWidth = [Math]::Max(1.0, $Width - (2 * $Padding))
$usableHeight = [Math]::Max(1.0, $Height - (2 * $Padding))
$scale = [Math]::Min($usableWidth / $dataWidth, $usableHeight / $dataHeight)
$offsetX = ($Width - ($dataWidth * $scale)) / 2.0
$offsetY = ($Height - ($dataHeight * $scale)) / 2.0

function Project-Point($coord) {
  $px = $offsetX + (([double]$coord[0] - $minX) * $scale)
  $py = $offsetY + (($maxY - [double]$coord[1]) * $scale)
  return [System.Drawing.PointF]::new([float]$px, [float]$py)
}

function Get-OverrideValue($override, [string]$name, [double]$fallback = 0.0) {
  if ($null -ne $override -and $null -ne $override.$name) {
    return [double]$override.$name
  }
  return $fallback
}

$bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::FromArgb(247, 251, 252))

$fillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(216, 238, 242))
$outlinePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(23, 52, 60), 2.0)

foreach ($feature in $floorplanFeatures) {
  foreach ($polygon in $feature.geometry.coordinates) {
    foreach ($ring in $polygon) {
      $points = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
      foreach ($coord in $ring) {
        [void]$points.Add((Project-Point $coord))
      }
      if ($points.Count -ge 3) {
        $array = $points.ToArray()
        $graphics.FillPolygon($fillBrush, $array)
        $graphics.DrawPolygon($outlinePen, $array)
      }
    }
  }
}

$images = @{
  door = [System.Drawing.Image]::FromFile($doorIconPath)
  doors = [System.Drawing.Image]::FromFile($doorsIconPath)
  stairs = [System.Drawing.Image]::FromFile($stairsIconPath)
  elevator = [System.Drawing.Image]::FromFile($elevatorIconPath)
}

foreach ($feature in $nodeFeatures) {
  $role = [string]$feature.properties.role
  if (-not $roleStyles.ContainsKey($role)) { continue }

  $style = $roleStyles[$role]
  $meta = $iconMeta[$role]
  $override = Get-Override ([string]$Floor) ([string]$feature.properties.id)
  $projected = Project-Point $feature.geometry.coordinates
  $size = Interpolate-Stops $style.SizeStops $Zoom
  $scaleOverride = Get-OverrideValue $override "scale" 1.0
  $dx = Get-OverrideValue $override "dx"
  $dy = Get-OverrideValue $override "dy"
  $rotateOverride = Get-OverrideValue $override "rotate"
  $angle = if ($null -ne $feature.properties.angle) { [double]$feature.properties.angle } else { 0.0 }
  $rotation = $angle + [double]$style.Rotate + $rotateOverride

  $iconWidth = [double]$meta.Width * $size * $scaleOverride
  $iconHeight = [double]$meta.Height * $size * $scaleOverride
  $centerX = $projected.X + [double]$style.OffsetX + $dx
  $centerY = $projected.Y + [double]$style.OffsetY + $dy

  $state = $graphics.Save()
  $graphics.TranslateTransform([float]$centerX, [float]$centerY)
  if ($rotation -ne 0) {
    $graphics.RotateTransform([float]$rotation)
  }
  $graphics.DrawImage(
    $images[$role],
    [System.Drawing.RectangleF]::new(
      [float](-$iconWidth / 2.0),
      [float](-$iconHeight / 2.0),
      [float]$iconWidth,
      [float]$iconHeight
    )
  )
  $graphics.Restore($state)
}

[System.IO.Directory]::CreateDirectory((Split-Path -Parent $OutFile)) | Out-Null
$bitmap.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)

foreach ($img in $images.Values) { $img.Dispose() }
$fillBrush.Dispose()
$outlinePen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Exported PNG to $OutFile"
