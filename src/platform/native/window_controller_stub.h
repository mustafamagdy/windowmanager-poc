#pragma once

namespace windowmanager {
struct WindowRect {
  int x;
  int y;
  int width;
  int height;
};

void log_initialize(const char* platform_name);
}  // namespace windowmanager
