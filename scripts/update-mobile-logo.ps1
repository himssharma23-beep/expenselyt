param(
  [string]$MobileRoot = 'C:\P\ExpenseManager_mobile'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height,
    [int]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-LogoBitmap {
  param(
    [int]$Size,
    [bool]$WithBackground = $true
  )

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  if ($WithBackground) {
    $bgRect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bgRect, ([System.Drawing.Color]::FromArgb(63, 132, 81)), ([System.Drawing.Color]::FromArgb(5, 45, 18)), 45
    $g.FillRectangle($bgBrush, $bgRect)
    $bgBrush.Dispose()
  } else {
    $g.Clear([System.Drawing.Color]::Transparent)
  }

  $left = [int]($Size * 0.13)
  $baseY = [int]($Size * 0.84)
  $barWidth = [int]($Size * 0.09)
  $gap = [int]($Size * 0.045)
  $barHeights = @(
    [int]($Size * 0.16),
    [int]($Size * 0.23),
    [int]($Size * 0.30),
    [int]($Size * 0.42),
    [int]($Size * 0.48),
    [int]($Size * 0.60)
  )
  $barTopColors = @(
    [System.Drawing.Color]::FromArgb(68, 207, 114),
    [System.Drawing.Color]::FromArgb(72, 212, 116),
    [System.Drawing.Color]::FromArgb(73, 212, 114),
    [System.Drawing.Color]::FromArgb(75, 212, 119),
    [System.Drawing.Color]::FromArgb(79, 213, 122),
    [System.Drawing.Color]::FromArgb(81, 216, 124)
  )
  $barBottomColors = @(
    [System.Drawing.Color]::FromArgb(29, 148, 71),
    [System.Drawing.Color]::FromArgb(34, 157, 77),
    [System.Drawing.Color]::FromArgb(38, 160, 79),
    [System.Drawing.Color]::FromArgb(40, 163, 80),
    [System.Drawing.Color]::FromArgb(42, 166, 82),
    [System.Drawing.Color]::FromArgb(44, 171, 86)
  )

  for ($i = 0; $i -lt $barHeights.Count; $i++) {
    $x = $left + ($i * ($barWidth + $gap))
    $height = $barHeights[$i]
    $y = $baseY - $height
    $barRect = New-Object System.Drawing.Rectangle $x, $y, $barWidth, $height
    $barBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $barRect, $barTopColors[$i], $barBottomColors[$i], 90
    $barPath = New-RoundedRectPath -X $x -Y $y -Width $barWidth -Height $height -Radius ([Math]::Max(4, [int]($barWidth * 0.18)))
    $g.FillPath($barBrush, $barPath)
    $barPath.Dispose()
    $barBrush.Dispose()
  }

  $trendPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(236, 157, 29)), ([float]($Size * 0.043))
  $trendPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $trendPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $trendPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $linePoints = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point ([int]($Size * 0.09), [int]($Size * 0.69))),
    (New-Object System.Drawing.Point ([int]($Size * 0.18), [int]($Size * 0.67))),
    (New-Object System.Drawing.Point ([int]($Size * 0.28), [int]($Size * 0.60))),
    (New-Object System.Drawing.Point ([int]($Size * 0.38), [int]($Size * 0.52))),
    (New-Object System.Drawing.Point ([int]($Size * 0.50), [int]($Size * 0.43))),
    (New-Object System.Drawing.Point ([int]($Size * 0.86), [int]($Size * 0.15)))
  )
  $g.DrawLines($trendPen, $linePoints)
  $trendPen.Dispose()

  $arrowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(243, 192, 93))
  $arrowPoints = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point ([int]($Size * 0.79), [int]($Size * 0.17))),
    (New-Object System.Drawing.Point ([int]($Size * 0.88), [int]($Size * 0.13))),
    (New-Object System.Drawing.Point ([int]($Size * 0.84), [int]($Size * 0.23)))
  )
  $g.FillPolygon($arrowBrush, $arrowPoints)
  $arrowBrush.Dispose()

  $orbRect = New-Object System.Drawing.Rectangle ([int]($Size * 0.47)), ([int]($Size * 0.39)), ([int]($Size * 0.18)), ([int]($Size * 0.18))
  $orbBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $orbRect, ([System.Drawing.Color]::FromArgb(255, 246, 214)), ([System.Drawing.Color]::FromArgb(140, 67, 8)), 45
  $g.FillEllipse($orbBrush, $orbRect)
  $orbBrush.Dispose()

  $highlightBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245, 255, 251, 229))
  $highlightRect = New-Object System.Drawing.Rectangle ([int]($Size * 0.515)), ([int]($Size * 0.435)), ([int]($Size * 0.05)), ([int]($Size * 0.05))
  $g.FillEllipse($highlightBrush, $highlightRect)
  $highlightBrush.Dispose()

  $g.Dispose()
  return $bmp
}

function Replace-InFile {
  param(
    [string]$Path,
    [string]$OldValue,
    [string]$NewValue
  )

  $content = Get-Content -Path $Path -Raw
  if (-not $content.Contains($OldValue)) {
    throw "Expected content not found in $Path"
  }
  $content = $content.Replace($OldValue, $NewValue)
  [System.IO.File]::WriteAllText($Path, $content)
}

$assetsDir = Join-Path $MobileRoot 'assets'
$icon = New-LogoBitmap -Size 1024 -WithBackground $true
$icon.Save((Join-Path $assetsDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Save((Join-Path $assetsDir 'adaptive-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Save((Join-Path $assetsDir 'playstore-icon-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Dispose()

$splash = New-Object System.Drawing.Bitmap 1284, 2778
$sg = [System.Drawing.Graphics]::FromImage($splash)
$sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$sg.Clear([System.Drawing.Color]::FromArgb(20, 90, 60))
$splashLogo = New-LogoBitmap -Size 720 -WithBackground $true
$sg.DrawImage($splashLogo, 282, 1029, 720, 720)
$sg.Dispose()
$splashLogo.Dispose()
$splash.Save((Join-Path $assetsDir 'splash.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$splash.Dispose()

$loginPath = Join-Path $MobileRoot 'src\screens\auth\LoginScreen.js'
$registerPath = Join-Path $MobileRoot 'src\screens\auth\RegisterScreen.js'

Replace-InFile -Path $loginPath `
  -OldValue "  View, Text, TextInput, TouchableOpacity, StyleSheet,`r`n  KeyboardAvoidingView, Platform, ScrollView, Alert,`r`n" `
  -NewValue "  View, Text, TextInput, TouchableOpacity, StyleSheet,`r`n  KeyboardAvoidingView, Platform, ScrollView, Alert, Image,`r`n"
Replace-InFile -Path $loginPath `
  -OldValue "            <Text style={s.logo}>EM</Text>" `
  -NewValue "            <Image source={require('../../../assets/icon.png')} style={s.logoImage} resizeMode=`"contain`" />"
Replace-InFile -Path $loginPath `
  -OldValue "  logo:     { fontSize: 36, fontWeight: '800', color: colors.primary, fontFamily: 'monospace', marginBottom: 8 }," `
  -NewValue "  logoImage: { width: 72, height: 72, marginBottom: 10 },"

Replace-InFile -Path $registerPath `
  -OldValue "  View, Text, TextInput, TouchableOpacity, StyleSheet,`r`n  KeyboardAvoidingView, Platform, ScrollView, Alert,`r`n" `
  -NewValue "  View, Text, TextInput, TouchableOpacity, StyleSheet,`r`n  KeyboardAvoidingView, Platform, ScrollView, Alert, Image,`r`n"
Replace-InFile -Path $registerPath `
  -OldValue "            <Text style={s.logo}>EM</Text>" `
  -NewValue "            <Image source={require('../../../assets/icon.png')} style={s.logoImage} resizeMode=`"contain`" />"
Replace-InFile -Path $registerPath `
  -OldValue "  logo:     { fontSize: 36, fontWeight: '800', color: colors.primary, fontFamily: 'monospace', marginBottom: 8 }," `
  -NewValue "  logoImage: { width: 72, height: 72, marginBottom: 10 },"
