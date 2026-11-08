# Perception research: breathing, person detection, triage score

Research for the rubble search robot dog in `docs/PROJECT.md` and `docs/ROBOT.md`, done on 2026-11-07.
Every external fact has a source URL.
Lines marked "Inference" are this file's own reasoning or arithmetic, not a sourced fact.
The thermal camera model is still unconfirmed, so the MLX90640 and AMG8833 numbers below are examples, not the team's part.

## Key takeaways and recommended stack

- Breathing rate: do not depend on Eulerian video magnification (EVM) for the number.
  Compute the rate from a simple motion signal on a chest region (mean pixel intensity change or optical flow), then band-pass and FFT.
  A TU Delft comparison of pixel intensity change, optical flow, and EVM found pixel intensity change the most accurate of the three and by far the fastest, and only pixel intensity change and optical flow ran in real time ([poster](https://cse3000-research-project.github.io/static/852fb3d00135fa1fcd908f315f124f04/poster.pdf)).
  Use EVM only to render a magnified clip for the operator and the judges.
- Clip length: record 20 s per stop, with 15 s as the floor.
  The published camera and thermal breathing methods use 20 s or 30 s windows ([Mattioli et al.](https://arxiv.org/pdf/2211.16046), [Cho et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5654794), [Zhu et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941)).
- Where it runs: the Pi records the clip with exposure and gain locked, and computes the simple ROI signal.
  The laptop renders EVM and can recompute the rate in Python.
  The original EVM C++ prototype ran 640x480 at 45 fps on a 2012 laptop CPU ([Wu et al. 2012](https://people.csail.mit.edu/mrub/papers/vidmag.pdf)), so a laptop is enough.
  No Pi 4 EVM benchmark was found.
- Near-infrared in the dark works for breathing when the scene is lit by IR illuminators: overnight sleep studies used NIR-sensitive cameras with IR lights ([Zhu et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941), [IEEE JBHI 2021](https://unpaywall.org/10.1109%2FJBHI.2020.3045859)).
- Thermal breathing at 32x24 or 8x8 from a robot standoff distance is not realistic.
  An 8x8 Grid-EYE study could not measure nostril temperature beyond 10 cm ([Sensors 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8400084/)).
  Use the thermal camera only to find warm, person-sized blobs.
- Camera person detection: skip the NCS2.
  OpenVINO dropped it in 2023.0, the last LTS line with it is 2022.3.x, and that line has no Python 3.11 bindings, while Debian 12 ships Python 3.11.
  Lowest risk: stream frames to a laptop and run a detector there.
  Second choice: Coral with the community `feranick` builds, which ship Debian bookworm arm64 packages and Python 3.11 aarch64 wheels.
  Camera detection is optional for the demo, because the thermal blob already gives the candidate.
- Critical score: START-inspired, with only two levels the robot can honestly assign, IMMEDIATE and DELAYED.
  It never assigns MINOR (it cannot see walking or command-following) and never EXPECTANT or DECEASED.
  "No breathing detected" maps to IMMEDIATE with low confidence.
- Thermal cannot see through rubble, boxes, or glass.
  A 1992 UK Home Office fire service report says solid cover of more than a few millimetres hides a body ([NFCC Pub 6/92](https://nfcc.org.uk/wp-content/uploads/2023/10/Publication-6_92-Detection-Devices-for-Hidden-or-Buried-Casualties.pdf)).
  The demo must leave part of the teammate in line of sight, and the pitch should say so.

## 1. Breathing from camera video

### The original method and the phase-based variants

- Eulerian video magnification (Wu, Rubinstein, Shih, Guttag, Durand, Freeman, SIGGRAPH 2012) decomposes each frame spatially (Laplacian or Gaussian pyramid), band-pass filters each pixel over time, multiplies that band by a factor alpha, and adds it back ([project page](https://people.csail.mit.edu/mrub/evm/), [paper](https://people.csail.mit.edu/mrub/papers/vidmag.pdf)).
- The paper shows the motion around the chest of a breathing baby.
  Its parameter table lists the "baby" video at alpha 10, spatial cutoff 16, pass band 0.4 to 3 Hz, 30 fps ([paper, Table 1](https://people.csail.mit.edu/mrub/papers/vidmag.pdf)).
- Limits from the paper: the linear approximation holds only for small motion, with the bound (1 + alpha) times displacement less than about one eighth of the spatial wavelength, and larger alpha amplifies noise and creates artifacts ([paper](https://people.csail.mit.edu/mrub/papers/vidmag.pdf)).
- The MIT MATLAB code is licensed for non-commercial research use only, and the work is patent pending ([project page](https://people.csail.mit.edu/mrub/evm/)).
- Phase-based video motion processing (Wadhwa, Rubinstein, Durand, Freeman, SIGGRAPH 2013) amplifies phase changes in a complex steerable pyramid.
  The authors say it supports larger amplification and is much less sensitive to noise than linear EVM ([project page](http://people.csail.mit.edu/nwadhwa/phase-video/)).
- Riesz pyramids (Wadhwa et al., ICCP 2014) are a cheaper phase representation that the authors say can run phase-based magnification in real time ([project page](https://people.csail.mit.edu/nwadhwa/riesz-pyramid/)).
  The page gives no speed numbers and no code license.

### What works for breathing specifically

- Mattioli et al. compared an amplitude (EVM-like) method and a phase (Riesz-like) method for breathing on newborn and adult videos.
  They skip rebuilding the video and only extract the motion signal.
  They use a band of 0.19 to 0.9 Hz for adults and 0.3 to 1.1 Hz for newborns, and 20 s windows.
  The phase method beat the amplitude method on every video, and the amplitude signal produced double-frequency errors ([arXiv 2211.16046](https://arxiv.org/pdf/2211.16046)).
  Their data was small and recorded indoors with still subjects, and the paper reports no runtime.
- A TU Delft student study (Carata-Dejoianu, 2024/25) compared pixel intensity change (PIC), optical flow (OF), and EVM on infant video with a manually chosen chest ROI.
  PIC was the most accurate of the three, PIC was the fastest by far, and only PIC and OF ran in real time.
  All three performed poorly on a hard dataset with blankets and many positions ([poster](https://cse3000-research-project.github.io/static/852fb3d00135fa1fcd908f315f124f04/poster.pdf)).
  This is a student poster, not a peer-reviewed paper.
- Zhu et al. tracked feature points across the frame in NIR video, discarded the 25% most and least moving points, and used PCA on 30 s windows.
  Over 50 adults overnight, about 89.9% of estimates were within 1 breath per minute of polysomnography ([PMC6889941](https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941)).

### Recommendation for this weekend

Inference, built from the sources above:

1. Robot stops, waits for the IMU to settle, and records 20 s of NoIR video at 30 fps with the IR illuminators on.
2. Lock exposure, gain, and white balance during the clip so the camera's auto modes do not create a fake periodic signal.
   `rpicam-vid` exposes shutter, gain, and AWB gain options for this ([Raspberry Pi camera docs](https://www.raspberrypi.com/documentation/computers/camera_software.html)).
3. Pick a chest ROI from the thermal blob position mapped into the camera frame, or let the operator drag a box on the laptop for the demo.
4. Signal: per frame, the mean of the absolute difference from a reference frame inside the ROI (PIC), or the mean vertical Farneback optical flow in the ROI (OF).
   Downscale the ROI to about 160x120 first.
5. Detrend, band-pass about 0.1 to 1.0 Hz (6 to 60 breaths per minute), and take the FFT peak.
   The upper edge has to stay above 0.5 Hz, because START treats a rate over 30 per minute as immediate (section 5).
   The 0.7 Hz edge in the brief would cap the rate at 42 per minute.
6. Quality: the fraction of band power in the peak bin and its neighbours, plus agreement between the two 10 s halves of the clip.
   Low quality means "inconclusive", never "not breathing".
7. Send the clip to the laptop, render EVM there with alpha about 10 and a 0.2 to 1 Hz band, and show it to the operator.

Why the clip length: an FFT over T seconds has a frequency resolution of 1/T Hz.
Inference: 10 s gives 0.1 Hz (6 breaths per minute) bins, too coarse to tell 24 from 30, while 20 s gives 3 breaths per minute bins.
Peak interpolation helps, but a slow breather at 6 per minute fits only one or two cycles into 15 s.

### Open-source implementations

| Repo | Language | License | Notes |
| --- | --- | --- | --- |
| [brycedrennan/eulerian-magnification](https://github.com/brycedrennan/eulerian-magnification) | Python | MIT | 503 stars, last push 2020 |
| [hbenbel/Eulerian-Video-Magnification](https://github.com/hbenbel/Eulerian-Video-Magnification) | Python | MIT | 97 stars, last push 2023 |
| [vgoehler/PyEVM](https://github.com/vgoehler/PyEVM) | Python | BSD-2-Clause | Fork of flyingzhao/PyEVM, uses OpenCV, NumPy, SciPy |
| [flyingzhao/PyEVM](https://github.com/flyingzhao/PyEVM) | Python | No license file | 243 stars, OpenCV 3 era; without a license, reuse is not granted |
| [tschnz/Live-Video-Magnification](https://github.com/tschnz/Live-Video-Magnification) | C++20, Qt 6, OpenCV | AGPL-3.0 | Live GUI, Laplacian, Riesz phase, and color modes; no benchmark numbers |
| [MIT EVM code](https://people.csail.mit.edu/mrub/evm/) | MATLAB | Non-commercial research only | Reference implementation |

License and activity data come from the GitHub API on 2026-11-07.
None of these repos publishes a Raspberry Pi 4 speed number.
The tschnz README says processing falls behind on slow hardware and suggests lowering resolution or shrinking the ROI ([repo](https://github.com/tschnz/Live-Video-Magnification)).
No maintained, licensed, breathing-specific repo stood out in a GitHub search, so writing the 50 to 100 lines of NumPy and OpenCV for steps 4 to 6 is likely faster than adapting one (inference).

### Pi 4 or laptop

- No published Pi 4 benchmark for EVM or breathing-rate extraction was found.
- Inference: the PIC signal is one subtraction and one mean per frame on a small ROI, so it should be cheap on a Pi 4 even in C++ inside the main program.
  Dense optical flow and pyramid EVM cost far more, so measure them on the Pi before relying on them.
- Recommendation: rate on the Pi (or on the laptop from the uploaded clip), EVM visuals on the laptop.

### Near-infrared in the dark

- Zhu et al. recorded overnight with a monochrome camera chosen for near-infrared sensitivity and a separate IR light, and got the accuracy above ([PMC6889941](https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941)).
- A 2021 IEEE JBHI study used near-infrared video on 8 sleep-center patients over 46.5 hours and reported respiratory rate within 2 breaths per minute 91% of the time ([IEEE JBHI](https://unpaywall.org/10.1109%2FJBHI.2020.3045859)).
  Only the abstract was read.
- Inference: motion methods only need steady illumination and texture on the chest, so NoIR plus fixed IR illuminators should work.
  The risks are illuminator flicker, saturated hot spots near the LEDs, and the auto-exposure drift covered in step 2.

### Failure cases

- Camera motion: any robot sway puts motion into every pixel.
  Zhu et al. had to drop at least 30 s of estimates after every large movement ([PMC6889941](https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941)).
  Gate on IMU stillness and on motion in a background ROI.
- Covered chest: blanket coverage changed error in Zhu et al. with thin sheets, and the authors warn thicker covers could be worse ([PMC6889941](https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941)).
  All three methods did poorly when blankets and clothes blocked the ROI in the TU Delft study ([poster](https://cse3000-research-project.github.io/static/852fb3d00135fa1fcd908f315f124f04/poster.pdf)).
- Low light and noise: linear EVM amplifies noise along with the signal ([Wu et al.](https://people.csail.mit.edu/mrub/papers/vidmag.pdf)).
- Irregular breathing: apnea and paradoxical breathing raised error in Zhu et al. ([PMC6889941](https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941)).
- Other periodic motion in the band (fans, a teammate shivering, the robot's own servos humming) can produce a false peak (inference).
  This is why the score treats a detected breath as "signs of life", not proof.

## 2. Breathing from thermal video

- Nostril methods need resolution.
  Cho et al. used a FLIR One (160x120, under 9 fps) at 20 to 55 cm, tracked the nostril region, and used 20 s windows.
  They say low spatial resolution weakens the respiratory signal ([PMC5654794](https://pmc.ncbi.nlm.nih.gov/articles/PMC5654794)).
- A 2026 study with a 256x192 thermal camera and a YOLO nostril detector on a Jetson Orin Nano reached 0.27 breaths per minute MAE at 1.0 m and 1.38 at 2.0 m, and says accuracy declines beyond 1.5 m ([Analia et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC12788367)).
- An AMG8833 (8x8, 10 fps) study found the sensor "cannot measure the nostril temperature changes beyond the distance of 10 cm".
  Without a face mask, the best error was 4.8 breaths per minute, and with a mask (a larger warm surface) it was 0.8 ([PMC8400084](https://pmc.ncbi.nlm.nih.gov/articles/PMC8400084/)).
- Lorato et al. measured airflow with a thermopile array on six subjects (1.59 breaths per minute RMSE) and found distance, orientation, and nasal versus oral breathing all mattered ([Applied Sciences 2019](https://doi.org/10.3390/app9122449)).
- No study using the MLX90640 for breathing was found.

Inference, pixel footprint at 1 m (pixel angle = FOV divided by pixel count):

| Sensor | Degrees per pixel (horizontal) | Pixel width at 1 m |
| --- | --- | --- |
| MLX90640 55 degree | about 1.7 | about 3 cm |
| MLX90640 110 degree | about 3.4 | about 6 cm |
| AMG8833 60 degree | 7.5 | about 13 cm |

Honest verdict: at a robot standoff of 0.5 to 2 m, a nostril is smaller than one pixel on any of these sensors, and the face may not point at the robot.
Thermal breathing detection is not feasible for this build.
Chest-surface temperature oscillation is not documented at these resolutions either.
Keep thermal for finding people.

## 3. Person detection with a low-resolution thermal sensor

The team's sensor model is unconfirmed.
Two common examples:

| Spec | MLX90640 | AMG8833 (Grid-EYE) |
| --- | --- | --- |
| Pixels | 32x24 | 8x8 |
| Field of view | 55x35 degrees (BAB) or 110x75 degrees (BAA) | 60x60 degrees typical |
| Frame rate | Programmable 0.5 to 64 Hz subpage rate; a full frame needs both subpages, so 0.25 to 32 fps | 10 fps or 1 fps typical |
| Noise | NETD 0.1 K RMS at 1 Hz; noise rises with refresh rate | NETD 0.05 C at 1 fps, 0.16 C at 10 fps |
| Accuracy | Frame accuracy about plus or minus 1 to 2 C depending on zone and model; valid only when the object fills the FOV | Typ. plus or minus 2.5 C |
| Object range | -40 to 300 C | 0 to 80 C |
| Human detection | Datasheet lists presence detection and person localization as applications | Max. 7 m, using Panasonic's software, a 700x250 mm object, and at least 4 C above background |
| Interface | I2C up to 1 MHz (Fast-mode Plus) | I2C, address 0x69 or 0x68 on the SparkFun board |

Sources: [MLX90640 datasheet](https://cdn.sparkfun.com/assets/3/1/c/6/f/MLX90640-Datasheet.pdf), [Waveshare MLX90640 page (fps)](https://www.waveshare.com/product/modules/sensors/mlx90640-d55-thermal-camera.htm), [Panasonic Grid-EYE reference specification](https://api.pim.na.industrial.panasonic.com/file_stream/main/fileversion/8799), [SparkFun AMG8833](https://www.sparkfun.com/products/14607).
The Grid-EYE spec also says output takes about 15 s to stabilise after power-up ([Panasonic spec](https://api.pim.na.industrial.panasonic.com/file_stream/main/fileversion/8799)).

### How people are detected

- Background subtraction: ThermoSense fits a Gaussian per pixel to the background and thresholds the probability, and argues one global temperature threshold fails across people and rooms ([arXiv 2004.05685](https://arxiv.org/pdf/2004.05685)).
- Another Grid-EYE study subtracts a per-pixel long-term background average and counts connected blobs ([arXiv 1511.08166](https://arxiv.org/pdf/1511.08166v1.pdf)).
- Thermopile partial-area effect: a pixel only partly covered by a person reads a blend, so distance cuts contrast, which matters most for wide-FOV, low-pixel sensors ([Lorato et al.](https://doi.org/10.3390/app9122449)).

Inference for a moving robot: a per-pixel background model breaks while the robot walks, because the background moves.
Use a per-frame threshold instead: pixels warmer than the frame median by a margin (start at the 4 C Grid-EYE test condition and tune on a teammate), then connected components, then a blob-size check against the size a person should have at the LiDAR range.
When the robot stops, switch to background subtraction over a few seconds to confirm.

Inference, expected blob size from a 700x250 mm target (the Grid-EYE test size), horizontal axis:

| Range | MLX90640 55 degree | AMG8833 |
| --- | --- | --- |
| 2 m | about 4 to 11 pixels | about 1 to 3 pixels |
| 4 m | about 2 to 6 pixels | under 1 to about 1 pixel |

The AMG8833 can say "something warm is over there" at a few metres, but it cannot tell a person from a radiator.
The range test in `PROJECT.md` is still required.

False positives to expect: hot electronics (including the robot's own Pi and motor drivers), sunlit surfaces, and reflections, because smooth surfaces mirror long-wave IR ([NFCC Pub 6/92](https://nfcc.org.uk/wp-content/uploads/2023/10/Publication-6_92-Detection-Devices-for-Hidden-or-Buried-Casualties.pdf)).

## 4. Person detection on camera images on the robot

### Intel NCS2 and OpenVINO

- OpenVINO 2023.0 dropped the Neural Compute Stick 2, HDDL, and Myriad X boards, and the release notes point to 2022.3.1 LTS for them ([2023.0 release notes](https://www.intel.com/content/www/us/en/developer/articles/release-notes/openvino/2023-0.html)).
- The MYRIAD plugin was removed from the source tree in commit "Remove myriad plugin (#15131)", January 2023 ([mirror of the commit](https://cdn09022024.gitlink.org.cn/natas_hw/openvino/src/commit/c4eeecfec539cec615652cf91ebd69dccc411c9e)); the GitHub PR page itself was not opened.
- 2022.3.2 LTS (May 2024) is the newest release that says "Intel Movidius VPU-based products are supported in this release" ([GitHub release](https://github.com/openvinotoolkit/openvino/releases/tag/2022.3.2)).
- PyPI wheels for 2022.3.1 and 2022.3.2 cover only CPython 3.7 to 3.10, and there is no Linux aarch64 wheel ([PyPI 2022.3.1](https://pypi.org/project/openvino/2022.3.1/#files), [PyPI JSON](https://pypi.org/pypi/openvino/2022.3.2/json)).
- Intel publishes an arm64 runtime archive built for Debian 9: `l_openvino_toolkit_debian9_2022.3.2.9279.e2c7e4d7b4d_arm64.tgz` ([download](https://storage.openvinotoolkit.org/repositories/openvino/packages/2022.3.2/linux/l_openvino_toolkit_debian9_2022.3.2.9279.e2c7e4d7b4d_arm64.tgz)).
  Its file list, checked on 2026-11-07, includes `libopenvino_intel_myriad_plugin.so`, `usb-ma2x8x.mvcmd`, the NCS udev rules script, the C++ runtime, and Python bindings for 3.7 and 3.9 only.
- Debian 12 bookworm ships Python 3.11.2 ([Debian packages](https://packages.debian.org/bookworm/python3)).
- Not confirmed: whether that Debian 9 archive runs on Debian 12 (library versions) and whether the NCS2 enumerates on a Pi 4 under bookworm.
  Forum reports show users hitting udev and build errors with NCS2 on Pi even on 2022.3.1 ([Intel community](https://community.intel.com/t5/Intel-Distribution-of-OpenVINO/Encountering-errors-on-same-step-of-NCS2-guide-for-multiple/m-p/1564697)).
- Verdict: the C++ API from the archive is the only plausible NCS2 path, Python would need a separate 3.9 interpreter, and both are untested.
  Too risky with 24 hours left.

### Google Coral USB

- The official Coral guide supports Debian 10 derivatives and Python 3.6 to 3.9 ([Coral get started](https://gweb-coral-full.uc.r.appspot.com/docs/accelerator/get-started/)).
  It installs `libedgetpu1-std` (reduced clock) or `libedgetpu1-max` (faster, runs very hot), never both, from the `coral-edgetpu-stable` apt repo.
- The `google-coral/pycoral` and `google-coral/libedgetpu` repos are archived (GitHub API, 2026-11-07), and the Python 3.10+ issue was never fixed upstream ([issue 85](https://github.com/google-coral/pycoral/issues/85)).
- The community `feranick` fork publishes `libedgetpu1-std` and `-max` packages for bookworm arm64 (release 16.0 TF2.19.1, September 2025) ([libedgetpu releases](https://github.com/feranick/libedgetpu/releases)), and pycoral 2.0.3 wheels for cp311 aarch64 (October 2024) ([pycoral releases](https://github.com/feranick/pycoral/releases)).
  The pycoral README says libcoral and libedgetpu must match the same TensorFlow commit ([feranick/pycoral](https://github.com/feranick/pycoral)), and the newest libedgetpu (TF 2.19.1) is newer than the newest pycoral (TF 2.17.1), so pick matching versions.
  Not tested by this research.
- Speed: on a Pi 4, moving the Coral USB to the USB 3 port cut MobileNet v1 SSD inference from 49.3 ms to 14.9 ms ([Hackster, Allan](https://www.hackster.io/news/benchmarking-machine-learning-on-the-new-raspberry-pi-4-model-b-88db9304ce4)).
  The same author saw only a 20 to 30% gain for the NCS2 on USB 3 ([Hackster NCS2](https://hackster.io/news/benchmarking-the-intel-neural-compute-stick-on-the-new-raspberry-pi-4-model-b-e419393f2f97)).

### CPU only on the Pi

- OpenCV DNN with MobileNetV1-SSD 300x300 ran about 3.66 fps on a bare Pi 4 ([Q-engineering](https://qengineering.eu/deep-learning-with-opencv-on-raspberry-pi-4.html)).
- Ultralytics says NCNN is the fastest export format on Raspberry Pi and was tested on Bookworm; its published numbers are for a Pi 5 (YOLO26n NCNN about 67 ms per image at 640) ([Ultralytics Raspberry Pi guide](https://docs.ultralytics.com/guides/raspberry-pi/)).
  No Pi 4 number is given there, and a Pi 4 is slower (inference from the CPU specs on the same page).
- For a stopped robot, 3 to 4 fps is enough to confirm "person in frame" (inference).

### Recommended path, least setup risk first

1. Laptop detection: the Pi streams or uploads NoIR frames over Wi-Fi, and the laptop runs a pip-installed YOLO nano model.
   Zero accelerator setup.
2. Pi CPU: OpenCV DNN MobileNet-SSD or YOLO nano through NCNN, a few fps, when the robot must work without the laptop.
3. Coral with the `feranick` packages, only if someone has an hour to spare and the Coral is physically on hand (the photo inventory does not show it).
4. NCS2: do not attempt this weekend.

Caveat (inference): COCO detectors are trained on colour daylight images, and NoIR frames under IR light are effectively monochrome with different contrast.
Expect lower confidence, and test on a real NoIR frame of a teammate early.

## 5. Triage

### How START works

START sorts casualties in about 30 s each using Respiration, Perfusion, and Mental status, and patients are re-triaged as more rescuers arrive ([San Mateo County Fire, Triage step by step](https://smcfire.ca.gov/files/517dc1718/Triage-Step-by-Step.pdf)).
The parameters are walking, spontaneous breathing, respiratory rate, a palpable radial pulse or capillary refill under 2 s, and ability to obey commands ([CHEMM, START](https://chemm.hhs.gov/incident-primer/triage/start-triage)).

Steps ([WikEM](https://wikem.org/wiki/Mass_casualty_incident_triage)):

1. Can walk: MINOR (green).
2. Not breathing: reposition the airway.
   Still not breathing: EXPECTANT or DECEASED (black).
   Breathes after repositioning: IMMEDIATE (red).
3. Respiratory rate over 30 per minute: IMMEDIATE.
4. Radial pulse absent or capillary refill over 2 s: IMMEDIATE.
5. Cannot follow simple commands: IMMEDIATE.
   Follows commands: DELAYED (yellow).

Category meanings ([CHEMM](https://chemm.hhs.gov/incident-primer/triage/start-triage)):

- IMMEDIATE (red): severe or life-threatening injuries but a high potential for survival.
- DELAYED (yellow): serious but not immediately life-threatening injuries.
- MINOR (green): minor injuries, unlikely to worsen over days.
- EXPECTANT (black): deceased or unlikely to survive given the injuries.

Known weaknesses:

- A 2021 meta-analysis of 32 studies found pooled START accuracy of 0.73, over-triage 0.14, and under-triage 0.10, and concluded START "is not accurate enough to serve as a reliable disaster triage tool" ([Franc et al., Prehospital and Disaster Medicine](https://www.cambridge.org/core/journals/prehospital-and-disaster-medicine/article/abs/metastart-a-systematic-review-and-metaanalysis-of-the-diagnostic-accuracy-of-the-simple-triage-and-rapid-treatment-start-algorithm-for-disaster-triage/9780160ABB6FD77AAAA941155C4A310E)).
- START defines only an upper respiratory limit, and a critique suggests adding a lower limit under 10 per minute ([JHMI critique, via search result](https://jhmi.sums.ac.ir/article_50425.html); the page itself did not load).
- SALT adds a separate gray EXPECTANT category for people who still show signs of life, to be reassessed if resources allow ([WikEM](https://wikem.org/wiki/Mass_casualty_incident_triage)).

### What the robot can and cannot observe

| START check | Robot | Why |
| --- | --- | --- |
| Walking | No | It sees a still person; stillness is not inability |
| Breathing present | Partly | Chest motion with a still camera and a visible chest or back |
| Respiratory rate over 30 | Partly | Only with a good-quality 20 s clip |
| Airway repositioning | No | Needs hands |
| Radial pulse or capillary refill | No | Needs touch; EVM pulse from skin colour needs a visible face and close range ([Wu et al.](https://people.csail.mit.edu/mrub/papers/vidmag.pdf)) |
| Follows commands | No | No speaker and no reliable response detection in this build (inference) |
| Visible body fraction | Partly | Thermal blob size versus expected size at LiDAR range |
| Skin or surface temperature | Rough | Plus or minus 1 to 2.5 C absolute, and only when the target fills pixels (section 3) |

### Proposed critical score (PROPOSED, weights are untuned guesses)

Inputs per survivor:

- `b`: breathing result, one of DETECTED, NOT_DETECTED, INCONCLUSIVE.
- `rr`: breaths per minute when DETECTED.
- `q`: breathing quality from 0 to 1 = spectral peak concentration, multiplied by 0 if the IMU or the background ROI shows motion, and by the fraction of the chest ROI that is visible.
- `v`: visible fraction from 0 to 1 = warm blob area divided by the expected person area at the measured range, capped at 1.
- `t`: minutes since found without a rescuer reaching them.
- `d`: thermal detection confidence from 0 to 1, from blob contrast above background and blob size match.
  Used for "is this a person", not for how sick they are.

Level (START-inspired, only what the robot can justify):

- IMMEDIATE if any of: `b` is NOT_DETECTED or INCONCLUSIVE, `rr` over 30, `rr` under 10, or `v` under 0.3 (mostly buried, cannot self-rescue, per `PROJECT.md`).
- DELAYED otherwise.
- Never MINOR and never EXPECTANT or DECEASED.
  Every survivor carries "needs human triage".

Priority within a level, from 0 to 100:

```
B = 1.0 if b is NOT_DETECTED or INCONCLUSIVE
    0.9 if rr > 30 or rr < 10
    0.3 otherwise
W = min(1, t / 30)
score = 100 * (0.5 * B + 0.3 * (1 - v) + 0.2 * W)
sort by level (IMMEDIATE first), then by score
```

Confidence shown next to the level:

```
if b == DETECTED:      confidence = q * d
else:                  confidence = min(0.3, d)    # absence of evidence is weak
```

Display text:

- DETECTED: "IMMEDIATE, breathing 34/min, confidence 0.71".
- NOT_DETECTED: "IMMEDIATE, no signs of life detected, low confidence (chest covered or camera moved), needs human check".
- INCONCLUSIVE: "IMMEDIATE, breathing unclear, low confidence, re-scan".

Why this shape:

- The lower rate bound of 10 is not part of START; it comes from the critique above, so say so in the pitch.
- `W` makes anyone left waiting rise over time, which matches the SpacetimeDB scheduled escalation in `PROJECT.md`.
- Thermal temperature is kept out of severity because the absolute accuracy (plus or minus 1 to 2.5 C) is too coarse to judge hypothermia or fever from a robot (inference from section 3).
- Re-scan: a second clip that finds breathing should move the person from "no signs of life" to a measured rate, mirroring START re-triage.

## 6. Thermal through dust and debris

- Long-wave IR does not pass through glass, plastic, water, or rubble, and solid cover of more than a few millimetres hides a body.
  The report calls thermal cameras' use for victims buried in collapsed buildings "almost certain to be unsuccessful", but useful in smoke, undergrowth, and darkness ([NFCC Pub 6/92, Home Office 1992](https://nfcc.org.uk/wp-content/uploads/2023/10/Publication-6_92-Detection-Devices-for-Hidden-or-Buried-Casualties.pdf)).
- In a simulated rubble pilot, a FLIR Lepton (160x120) on a pole pushed into gaps confirmed victims only through openings.
  Obstacles made verification "impossible" in some trials, and the authors say a thermal-only system "is not robust" ([Zhang et al., Sensors 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877370)).
- In fire smoke, IR cameras and radar outperformed other sensors, and lidar range errors appeared once visibility dropped below about 4 m ([Starr and Lattimer, Fire Technology 2014](https://link.springer.com/article/10.1007/s10694-013-0356-3), abstract only).
  This matters for the LD19 too.
- Not found: any study measuring thermal detection rate versus dust density or burial depth.
  Dust is not smoke, so the smoke result is suggestive only.
- Inference for the demo: a thin blanket over a warm person should warm up and show a weaker warm shape after some minutes, while cardboard boxes block the view.
  Test both before the demo, and leave a head, arm, or back in line of sight.

## Open items to confirm

- Thermal sensor model, FOV, and achievable frame rate over the Pico I2C bus.
- Whether the Coral is on hand.
- A real NoIR plus IR illuminator test clip of a teammate under a blanket, to check the breathing signal and the detector.
- Where the operator chooses the chest ROI if automatic mapping from the thermal blob is not ready.

## Sources

- Wu et al. 2012, Eulerian Video Magnification: https://people.csail.mit.edu/mrub/evm/ and https://people.csail.mit.edu/mrub/papers/vidmag.pdf
- Wadhwa et al. 2013, Phase-Based Video Motion Processing: http://people.csail.mit.edu/nwadhwa/phase-video/
- Wadhwa et al. 2014, Riesz Pyramids: https://people.csail.mit.edu/nwadhwa/riesz-pyramid/
- Mattioli et al., Motion Magnification Algorithms for Video-Based Breathing Monitoring: https://arxiv.org/pdf/2211.16046
- Carata-Dejoianu, TU Delft CSE3000 poster: https://cse3000-research-project.github.io/static/852fb3d00135fa1fcd908f315f124f04/poster.pdf
- Zhu et al. 2019, Vision-Based Heart and Respiratory Rate Monitoring During Sleep: https://pmc.ncbi.nlm.nih.gov/articles/PMC6889941
- Camera-Based Vital Signs Monitoring During Sleep, IEEE JBHI 2021: https://unpaywall.org/10.1109%2FJBHI.2020.3045859
- Cho et al. 2017, Robust tracking of respiratory rate using mobile thermal imaging: https://pmc.ncbi.nlm.nih.gov/articles/PMC5654794
- Analia et al. 2026, Adaptive Thermal Imaging Signal Analysis: https://pmc.ncbi.nlm.nih.gov/articles/PMC12788367
- Thermopile-Based Contactless Respiratory Gating, Sensors 2021: https://pmc.ncbi.nlm.nih.gov/articles/PMC8400084/
- Lorato et al. 2019, Unobtrusive Respiratory Flow Monitoring Using a Thermopile Array: https://doi.org/10.3390/app9122449
- MLX90640 datasheet: https://cdn.sparkfun.com/assets/3/1/c/6/f/MLX90640-Datasheet.pdf
- Waveshare MLX90640 D55: https://www.waveshare.com/product/modules/sensors/mlx90640-d55-thermal-camera.htm
- Panasonic Grid-EYE reference specification: https://api.pim.na.industrial.panasonic.com/file_stream/main/fileversion/8799
- SparkFun AMG8833: https://www.sparkfun.com/products/14607
- ThermoSense: https://arxiv.org/pdf/2004.05685
- Grid-EYE occupancy: https://arxiv.org/pdf/1511.08166v1.pdf
- OpenVINO 2023.0 release notes: https://www.intel.com/content/www/us/en/developer/articles/release-notes/openvino/2023-0.html
- OpenVINO MYRIAD removal commit (mirror): https://cdn09022024.gitlink.org.cn/natas_hw/openvino/src/commit/c4eeecfec539cec615652cf91ebd69dccc411c9e
- OpenVINO 2022.3.2 release: https://github.com/openvinotoolkit/openvino/releases/tag/2022.3.2
- OpenVINO PyPI 2022.3.1 files: https://pypi.org/project/openvino/2022.3.1/#files
- OpenVINO 2022.3.2 arm64 archive: https://storage.openvinotoolkit.org/repositories/openvino/packages/2022.3.2/linux/l_openvino_toolkit_debian9_2022.3.2.9279.e2c7e4d7b4d_arm64.tgz
- Intel community NCS2 errors: https://community.intel.com/t5/Intel-Distribution-of-OpenVINO/Encountering-errors-on-same-step-of-NCS2-guide-for-multiple/m-p/1564697
- Debian bookworm python3: https://packages.debian.org/bookworm/python3
- Coral get started: https://gweb-coral-full.uc.r.appspot.com/docs/accelerator/get-started/
- pycoral issue 85: https://github.com/google-coral/pycoral/issues/85
- feranick/pycoral: https://github.com/feranick/pycoral and https://github.com/feranick/pycoral/releases
- feranick/libedgetpu releases: https://github.com/feranick/libedgetpu/releases
- Hackster Pi 4 ML benchmark: https://www.hackster.io/news/benchmarking-machine-learning-on-the-new-raspberry-pi-4-model-b-88db9304ce4
- Hackster Pi 4 NCS2 benchmark: https://hackster.io/news/benchmarking-the-intel-neural-compute-stick-on-the-new-raspberry-pi-4-model-b-e419393f2f97
- Q-engineering OpenCV DNN on Pi 4: https://qengineering.eu/deep-learning-with-opencv-on-raspberry-pi-4.html
- Ultralytics Raspberry Pi guide: https://docs.ultralytics.com/guides/raspberry-pi/
- Raspberry Pi camera software docs: https://www.raspberrypi.com/documentation/computers/camera_software.html
- EVM repos: https://github.com/brycedrennan/eulerian-magnification, https://github.com/hbenbel/Eulerian-Video-Magnification, https://github.com/vgoehler/PyEVM, https://github.com/flyingzhao/PyEVM, https://github.com/tschnz/Live-Video-Magnification
- CHEMM START triage: https://chemm.hhs.gov/incident-primer/triage/start-triage
- WikEM mass casualty triage: https://wikem.org/wiki/Mass_casualty_incident_triage
- San Mateo County Fire, Triage step by step: https://smcfire.ca.gov/files/517dc1718/Triage-Step-by-Step.pdf
- Franc et al. 2021, META-START meta-analysis: https://www.cambridge.org/core/journals/prehospital-and-disaster-medicine/article/abs/metastart-a-systematic-review-and-metaanalysis-of-the-diagnostic-accuracy-of-the-simple-triage-and-rapid-treatment-start-algorithm-for-disaster-triage/9780160ABB6FD77AAAA941155C4A310E
- START and JumpSTART critique: https://jhmi.sums.ac.ir/article_50425.html
- NFCC Publication 6/92, Detection Devices for Hidden or Buried Casualties: https://nfcc.org.uk/wp-content/uploads/2023/10/Publication-6_92-Detection-Devices-for-Hidden-or-Buried-Casualties.pdf
- Zhang et al. 2018, Sensor System for Detecting Humans Trapped under Rubble: https://pmc.ncbi.nlm.nih.gov/articles/PMC5877370
- Starr and Lattimer 2014, Evaluation of Navigation Sensors in Fire Smoke Environments: https://link.springer.com/article/10.1007/s10694-013-0356-3
