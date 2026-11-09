/* dk-unmirror: if displays are mirrored (Mirror Displays ON), switch them to Extended. No-op otherwise. */
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>

int main(void) {
  CGDirectDisplayID ids[16];
  uint32_t n = 0;
  if (CGGetOnlineDisplayList(16, ids, &n) != kCGErrorSuccess) return 1;
  CGDisplayConfigRef cfg;
  if (CGBeginDisplayConfiguration(&cfg) != kCGErrorSuccess) return 1;
  int changed = 0;
  for (uint32_t i = 0; i < n; i++) {
    if (CGDisplayIsInMirrorSet(ids[i])) {
      CGConfigureDisplayMirrorOfDisplay(cfg, ids[i], kCGNullDirectDisplay);
      changed = 1;
    }
  }
  if (!changed) { CGCancelDisplayConfiguration(cfg); printf("no mirroring\n"); return 0; }
  CGError e = CGCompleteDisplayConfiguration(cfg, kCGConfigureForSession);
  printf("unmirrored: %d\n", (int)e);
  return e == kCGErrorSuccess ? 0 : 2;
}
