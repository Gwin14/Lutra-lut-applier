Pod::Spec.new do |s|
  s.name           = 'LutraEngine'
  s.version        = '1.0.0'
  s.summary        = 'Lutra native render engine (AVFoundation + Metal)'
  s.description    = 'Decodes, grades with a baked LUT and re-encodes video on the GPU.'
  s.license        = 'UNLICENSED'
  s.author         = 'Lutra'
  s.homepage       = 'https://lutra.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreMedia', 'CoreVideo', 'Metal', 'CoreImage', 'VideoToolbox', 'BackgroundTasks', 'ActivityKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
