## Inspiration

In 2025, the United States recorded a preliminary **1,559 tornadoes**, while catastrophic flooding in the Texas Hill Country claimed at least **135 lives**. Natural disasters can overwhelm emergency response teams, leaving them to survey damaged neighborhoods, locate survivors, and determine who needs help first, all while navigating potentially dangerous environments.

Living in **San Antonio, Texas**, severe weather and tornado warnings have made these concerns feel especially close to home. We started thinking about the challenges first responders face after a disaster, particularly when hundreds of people may need assistance simultaneously. Searching damaged buildings takes time, and responders often have limited information about where survivors are located or what conditions they may encounter.

This led us to the central question behind **State Farm's Intelligent Catastrophe Response Challenge**: How can we use AI and technology to identify those with the most urgent needs, coordinate assistance, and ensure nobody is overlooked?

Rubble is slow and dangerous to cross on foot or on wheels, but easy to fly over. So we built a search-and-rescue system around a **drone that goes in first**: it surveys the disaster area from above, finds potential survivors, and feeds a shared, real-time platform that coordinates the rescue.

## What it does

Our project combines an **aerial search drone, AI-assisted rescue coordination, and real-time communication** to help emergency teams locate and prioritize survivors following natural disasters.

- **Surveys hazardous environments from above**: A drone flies a search pattern over the disaster area, so responders know where to look before they go in.
- **Identifies potential survivors**: A thermal camera looks for warm, person-sized shapes in the rubble below.
- **Analyzes signs of life**: The drone hovers over each candidate and records about 20 seconds of video, and Eulerian video magnification helps detect subtle movement such as breathing.
- **Prioritizes urgent cases**: A severity-assessment workflow scores each discovery, so rescuers can focus on the people who may need immediate attention. The system never labels anyone as dead; "no signs of life detected" stays at the top of the list.
- **Coordinates rescue operations**: A multi-agent architecture using NVIDIA Nemotron organizes rescue tasks, reviews proposed actions, and communicates important updates.
- **Synchronizes information in real time**: SpacetimeDB keeps survivor discoveries, drone activity, and rescue assignments in one shared, live system.
- **Visualizes disaster response**: A centralized dashboard lets coordinators watch the search and manage rescue operations.
- **Guides responders**: A smart-glasses interface shows how many critical survivors are nearby and points the way to the next one, directly in the responder's field of view.
- **Sends help in second**: A ground rover can follow up on a find for a closer look where the drone cannot reach.

Our hackathon demonstration uses a simulated disaster scenario connected to a live SpacetimeDB backend. As the simulated drone discovers a survivor, the information is synchronized with the dashboard and the responder's glasses view, demonstrating how emergency teams could coordinate through one shared system.

## How we built it

### State Farm: Intelligent Catastrophe Response

We structured our project around the challenge of coordinating emergency assistance during large-scale disasters. Our system focuses on three connected stages: **discovering survivors, assessing urgency, and coordinating a response**.

The drone discovers survivors, the severity assessment decides who needs help first, and a shared board coordinates rescuers. "Nobody is overlooked" is enforced by the database itself, not left to the AI: every survivor stays on the board until a person resolves them, a responder who drops offline has their assignment released immediately, and a watchdog assigns the nearest rescuer if no one else does. The dashboard's headline tracks it directly: "Critical survivors unattended over 60 s: 0".

### NVIDIA: Nemotron Beyond a Chatbot

We designed a multi-agent architecture around NVIDIA Nemotron to explore how AI could support more complex emergency-response workflows.

Our architecture separates responsibilities across three specialized agents:

- **Orchestrator**: ranks survivors, proposes the nearest available rescuer, and plans the drone's next search area.
- **Auditor**: reviews proposed actions and assessments to provide an additional layer of oversight.
- **Communications Agent**: briefs rescuers on their glasses and answers their questions.

The agents work with structured rescue information and support multi-step workflows instead of chatting. They coordinate only through a shared task board in SpacetimeDB, so every hand-off is logged and can be replayed. No agent can fly the drone or close out a survivor; those stay with people.

### SpacetimeDB: Real-Time Rescue Coordination

We used **SpacetimeDB as the central backend** connecting every part of our project, with no separate web server or API layer.

Our SpacetimeDB module was built and deployed to Maincloud, with generated TypeScript bindings used across the application.

- **Centralizes rescue data**: stores survivors, search areas, drone activity, rescue assignments, briefings, and the agents' task board.
- **Synchronizes connected interfaces**: streams database changes to the coordinator dashboard and responder views through live subscriptions.
- **Runs the rules and timers**: reducers enforce the survivor workflow, and schedule tables run every timer (assignment leases, heartbeats, escalation, and the agent watchdog) inside the database.
- **Supports multiple responders**: every coordinator and responder sees the same live view as the information changes.
- **Powers our live demonstration**: connects the rescue simulation to the dashboard and smart-glasses display.

This allowed us to focus on the rescue workflow without building a separate synchronization system for every interface.

### Sensing and Hardware

We built the sensing and control foundation using a **Raspberry Pi 4B, Raspberry Pi Pico, and C++**: the same stack a drone would carry.

The Pico reads the sensors (a thermal camera, a 360-degree lidar, a single-point lidar, and an IMU) and streams them to the Raspberry Pi, which finds warm, person-sized shapes using explainable rules and reports them to SpacetimeDB through a Node.js bridge. We also developed a state machine with safety logic, so the system stops on its own if a sensor or the connection fails.

We first built this stack for a ground robot. When the robot's leg servos overheated during testing, we moved to a drone-first approach, which suits rubble better, and kept the ground robot as a follow-up vehicle. For the hackathon demonstration, we used a simulated drone to represent the search, survivor discovery, and sensor results, while developing and testing the hardware separately.

## Challenges we ran into

One of our biggest challenges was adjusting to a project that was so heavily focused on hardware. We had to familiarize ourselves with different sensors, microcontrollers, and the many moving parts involved in a robotic system. Understanding how each component worked individually was already a learning curve, and figuring out how they would communicate added another level of complexity.

Our hardware plans also changed during the weekend. We started with a walking robot, and when its leg servos overheated, we had to decide quickly what to keep. Because every part of the system talks through the same database, we could change the search vehicle to a drone without rebuilding the dashboard, the agents, or the glasses.

Managing the scope of our project was another challenge. With so many possibilities for robotics, computer vision, and AI, it was easy to get caught up in adding new features. We had to continually revisit our original idea and make sure each component contributed to our goal of improving disaster response.

Integrating several technologies within a single weekend also required us to make decisions about what we could realistically demonstrate. We focused on building a working real-time rescue coordination workflow while developing the more experimental hardware and AI components separately.

## Accomplishments we're proud of

We're especially proud of bringing together several different technologies into one coordinated search-and-rescue concept.

We successfully built and deployed our SpacetimeDB backend, developed a rescue simulation, and created interfaces that display shared rescue information in real time.

We're also proud of getting real sensor data flowing on the hardware side: the Pico streams the thermal camera, both lidars, and the IMU to the Raspberry Pi. We also designed a multi-agent AI architecture with clearly separated responsibilities.

The biggest accomplishment for our team was learning how to approach a problem that required us to work across hardware, software, and AI simultaneously, and how to change direction quickly when the hardware didn't cooperate.

## What we learned

Throughout the weekend, we gained hands-on experience with embedded systems, sensor integration, real-time databases, and multi-agent AI architectures.

Working with SpacetimeDB taught us how useful reactive databases can be when several applications need access to the same information. Exploring NVIDIA Nemotron also challenged us to think about AI as part of a larger workflow, where individual agents have specific responsibilities.

On the hardware side, we learned how much planning goes into a robotic platform, from understanding sensor inputs to designing control logic and safety behavior, and that power and heat matter as much as code.

We also learned the importance of keeping a project focused, especially during a hackathon. Having a clear goal helped us make decisions about which features to prioritize, and a shared backend made it possible to pivot without starting over.

## What's next

We plan to mount the sensing stack on a real drone and connect its thermal detection, perception system, and AI agents to the live rescue workflow.

Future improvements include testing thermal detection from the air at different heights, improving survivor detection, pairing the drone with the ground rover for close inspection, expanding smart-glasses functionality, and evaluating the system in more realistic disaster simulations.

Our goal is to create a platform that gives first responders more information, improves coordination between rescue teams, and helps communities respond more effectively when disasters occur.
