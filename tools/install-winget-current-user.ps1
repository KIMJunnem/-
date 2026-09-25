$ProgressPreference='SilentlyContinue'
Install-PackageProvider -Name NuGet -Force -Scope CurrentUser | Out-Null
Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery -Scope CurrentUser | Out-Null
Import-Module Microsoft.WinGet.Client
Repair-WinGetPackageManager -Force -Latest
