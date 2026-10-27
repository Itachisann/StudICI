Pod::Spec.new do |s|
  s.name           = 'StudICIAlarms'
  s.version        = '1.0.0'
  s.summary        = 'Native iOS 26 AlarmKit and system alarm scheduler for StudICI'
  s.description    = 'Native iOS 26 AlarmKit and system alarm scheduler for StudICI'
  s.license        = 'MIT'
  s.author         = 'StudICI'
  s.homepage       = 'https://github.com/Itachisann/StudICI'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
