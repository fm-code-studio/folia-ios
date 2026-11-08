require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'FoliaNative'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/chthollyphile/folia-major'
  s.author = package['author']
  s.source = { :git => 'https://github.com/chthollyphile/folia-major.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
  # WebKit for the scheme handler, MediaPlayer for the lock screen, AVFoundation for
  # the audio session that keeps playback alive off the screen.
  s.frameworks = 'WebKit', 'MediaPlayer', 'AVFoundation', 'UIKit'
end
