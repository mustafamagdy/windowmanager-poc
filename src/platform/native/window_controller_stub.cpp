#include "window_controller_stub.h"

#include <iostream>

namespace windowmanager {

void log_initialize(const char* platform_name) {
  std::cout << "Initializing window controller for platform: " << platform_name << std::endl;
}

}  // namespace windowmanager
