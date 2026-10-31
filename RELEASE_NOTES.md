## What's New in v1.3.0

- **Native Fullscreen & Theatre Mode Toggle**: Seamlessly switch directly between native fullscreen and theatre mode without manual multi-step toggling, including automatic Top Layer reparenting.
- **Auto-Fade Controls**: Floating buttons automatically fade out after 3 seconds of mouse inactivity and instantly hide when the pointer leaves the browser window.
- **Streaming Platform Layout Fixes**: Overrode ancestor `max-height` constraints and resolved stacking-context issues on sites like Twitch and YouTube.
- **Clean Fullscreen Teardown**: Preserves host platform fullscreen styling when moving from theatre mode into native fullscreen without style collisions.
- **Instant Viewport Snapping**: Automatically snaps the video player back into the viewport upon exiting theatre mode if it was scrolled off-screen.
- **Namespace Modernization**: Renamed CSS class namespace to `theatre-vision-ext-*` and removed unused legacy constants.
- **Enhanced Localization**: Added `"switchToTheatreMode"` localized string across all 14 supported languages.
