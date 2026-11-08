import Capacitor
import FoliaNative
import UIKit

/// The bridge view controller the app starts with.
///
/// Capacitor's storyboard names a class from the app target, so Folia's own bridge
/// controller (the local scheme handler, the runtime config script, the immersive
/// chrome) is reached through this one-line subclass rather than by naming the pod's
/// class in the storyboard.
class MainViewController: FoliaBridgeViewController {}
