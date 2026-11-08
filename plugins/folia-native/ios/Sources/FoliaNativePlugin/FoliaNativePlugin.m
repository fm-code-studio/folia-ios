#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the plugin with the bridge. The Swift side carries the implementation;
// this file only tells Capacitor which methods it has.
CAP_PLUGIN(FoliaNativePlugin, "FoliaNative",
           CAP_PLUGIN_METHOD(pickDirectory),
           CAP_PLUGIN_METHOD(readFile),
           CAP_PLUGIN_METHOD(listDirectory),
           CAP_PLUGIN_METHOD(removeLibrary),
           CAP_PLUGIN_METHOD(setImmersive),
           CAP_PLUGIN_METHOD(updateNowPlaying),
           CAP_PLUGIN_METHOD(configureAudioSession),
           CAP_PLUGIN_METHOD(getRuntimeConfig));
