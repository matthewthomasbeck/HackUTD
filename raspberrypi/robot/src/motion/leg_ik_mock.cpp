#include "motion/leg_ik.hpp"

namespace robot {

namespace {

class LegIkMock : public ILegIK {
 public:
  bool solve(const LegRequest&, std::vector<ServoTarget>& out) override {
    out.clear();
    return true;
  }
};

}  // namespace

std::shared_ptr<ILegIK> make_leg_ik_mock() { return std::make_shared<LegIkMock>(); }

}  // namespace robot
