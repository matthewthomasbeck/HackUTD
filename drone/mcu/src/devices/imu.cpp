#include "devices/imu.hpp"

namespace imu {

// TODO(imu): write the driver once the team confirms the drone's IMU model, bus, and address.
// Until then nothing is probed, so no bus traffic goes to a part that may not be there.
bool init(DevStatus& st) {
    dev_reset(st, "imu");
    return dev_set(st, DevState::NotFound, "driver not written: IMU model TBD");
}

bool read(Sample& out) {
    out = Sample{};
    return false;
}

} // namespace imu
