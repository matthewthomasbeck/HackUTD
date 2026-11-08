# Produced water operations: real-world grounding for "Beat the Shutdown"

Research for the EOG sponsor challenge, compiled 2026-11-07.
Every fact has a source URL.
Statements marked **Inference** are my own reasoning, not a sourced fact.
Statements marked **Unverified** came from a secondary or AI-summarized source that I could not confirm against the primary document.
Many cost figures are old (2018 to 2020), so treat them as ranges and say so in the pitch.

## Key takeaways for the pitch

- EOG already does a version of this challenge in production: its 2024 Sustainability Report says its control centers are "continuously staffed to monitor pump volumes, line pressure, sensors, and other operational parameters", and can "remotely shut down or reroute flow if a potential spill is detected" ([EOG 2024 SR](https://eogresources.s3.us-east-2.amazonaws.com/EOG_2024_Sustainability_Report.pdf)).
- EOG builds its own tools and names them: iDetect (leak detection that "integrates sensor data with other operational data"), miDetect (its mobile version, which pushes alarms with "a description and volume estimate of the potential leak" to field staff phones), Trident (water logistics map and scenario planning), and iSense (continuous methane monitoring) ([EOG 2024 SR](https://eogresources.s3.us-east-2.amazonaws.com/EOG_2024_Sustainability_Report.pdf)).
  **Inference:** pitch the console as speaking iDetect's language (evidence plus volume estimate plus recommended action), not as a replacement for SCADA.
- The scale is huge: the Permian produces roughly 20 to 21 million barrels of water per day ([AOGR](https://www.aogr.com/magazine/editors-choice/climbing-water-cuts-produced-water-volumes-create-challenges-in-permian), [Texas Tech TAWC slides](https://www.depts.ttu.edu/tawc/events/water-college/wc2025/leeds.pdf)), and the Delaware Basin (EOG's most active area) makes about 4 to 8 barrels of water per barrel of oil ([World Oil](https://www.worldoil.com/magazine/2022/july-2022/special-focus-permian-basin-technology-shale-technology/the-great-saltwater-flood-in-the-permian-basin/)).
- Trucking is the expensive fallback: about $2.50 per barrel by truck versus about $0.30 per barrel by pipe (Wood Mackenzie, 2018, [press release](https://woodmac.com/press-releases/permian-produced-water)).
  The challenge's `ops.json` prices a trip at $905 for 150 bbl, which is about $6.03 per barrel.
  **Inference:** about 2.4 times the 2018 routine rate is plausible for an emergency night call-out, so the sim's prices are in a believable range.
- **Inference (key pitch insight):** whether trucks beat a shut-in depends on the water-to-oil ratio.
  At $60 oil and 4 to 8 bbl water per bbl oil (Delaware), each barrel of water a well makes carries about $7.50 to $15 of oil revenue, close to the ~$6 truck cost.
  At 2 to 3 bbl water per bbl oil (Midland), it carries $20 to $30, so trucking wins easily.
  That is why the "shut in the cheapest, wettest well" option in the challenge is real, not a trick.
- Spills are common and visible: Texas RRC records show more than 10,000 produced water spills and more than 148 million gallons spilled from 2013 to 2022 ([Inside Climate News](https://insideclimatenews.org/news/31102023/oil-gas-companies-spill-wastewater-in-texas/)), and New Mexico logs roughly 700 to 850 produced water spills per year ([NM Political Report](https://nmpoliticalreport.com/?p=238670), [Ropes Soap n Dope summary](https://ropesoapndope.com/spills-related-to-oil-and-gas-declined-in-new-mexico-in-2019)).
- EOG itself reported 15,387 bbl of produced water spilled in 2024, with 71% recovered, and ties oil spill performance to executive pay ([EOG 2024 SR](https://eogresources.s3.us-east-2.amazonaws.com/EOG_2024_Sustainability_Report.pdf)).
  **Inference:** a leak caught one hour earlier is a number EOG leadership already tracks.
- Disposal capacity is not guaranteed: after the Texas RRC suspended deep injection in the Gardendale area (effective Dec 31, 2021), ConocoPhillips lost about 186,000 bbl/d of disposal capacity and a Diamondback subsidiary lost about 150,000 bbl/d ([Claims Journal / Bloomberg](https://claimsjournal.com/news/southcentral/2022/01/07/307955.htm)).
- False dispatches are the pain EOG named: generic field-service data says 17% to 25% of truck rolls are "no fault found" and a fully loaded visit can approach $1,000 ([Blitzz](https://blitzz.co/blog/the-real-cost-of-a-truck-roll-and-how-to-avoid-it)), but I found no oilfield-specific number.
  Present this as a gap the product measures, not a sourced claim about EOG.

## 1. How produced water works in the Permian and Delaware basins

### Volumes

- Permian produced water was about 21 million bbl/d in Q3 2024, per a Texas Pacific Water Resources executive quoted by AOGR ([AOGR](https://www.aogr.com/magazine/editors-choice/climbing-water-cuts-produced-water-volumes-create-challenges-in-permian)).
- A Texas Tech water conference deck gives about 21 million bbl/d in 2025, about 1 billion gallons per day ([TTU TAWC](https://www.depts.ttu.edu/tawc/events/water-college/wc2025/leeds.pdf)).
- The Texas Permian alone generated about 3.9 billion barrels (over 168 billion gallons) per year as of 2019, per a 2022 report cited by Inside Climate News ([ICN](https://insideclimatenews.org/news/31102023/oil-gas-companies-spill-wastewater-in-texas/)).
- An AAPG Bulletin study puts 2022 unconventional produced water at about 5 billion barrels, 70% from the Delaware Basin and 30% from the Midland Basin ([AAPG Bulletin](https://archives.datapages.com/data/bulletns/2024/12dec/BLTN24025/bltn24025.html)).
- Texas does not require regular reporting of produced water volumes, so the Texas Produced Water Consortium built its estimates from sampling and disposal records ([summary of TxPWC method](https://www.ksat.com/news/texas/2024/12/10/recycled-oilfield-water-could-aid-drought-stricken-west-texas/)).
  **Inference:** basin totals are estimates, so cite them as "about 20 million bbl/d".

### Water-to-oil ratio

- Midland Basin: about 2 to 3 bbl water per bbl oil; Delaware Basin: about 4 to 8, sometimes up to 10 ([World Oil 2022](https://www.worldoil.com/magazine/2022/july-2022/special-focus-permian-basin-technology-shale-technology/the-great-saltwater-flood-in-the-permian-basin/), [Wood Mackenzie](https://woodmac.com/press-releases/permian-produced-water)).
- Bridget Scanlon (UT Bureau of Economic Geology) gives about 2:1 in the Midland and 4 to 5:1 in the Delaware ([BEG podcast transcript](https://wrp.beg.utexas.edu/script/assessing-potential-for-beneficial-use-of-produced-water-in-the-texas-permian-basin)).
- Scanlon et al. 2020 (ES&T, doi 10.1021/acs.est.9b06390) project that produced water exceeds frac water demand by about 3.7 times in the Delaware and 1.3 times in the Midland ([BEG PDF](https://www.beg.utexas.edu/files/research-study/Will%20Water%20Issues%20Constrain%20Oil%20and%20Gas%20Production%20in%20the%20U_S__.pdf)).
  This is why disposal and recycling capacity are a constraint, not an afterthought.
- Water cut usually rises over a well's life ([World Oil](https://www.worldoil.com/magazine/2022/july-2022/special-focus-permian-basin-technology-shale-technology/the-great-saltwater-flood-in-the-permian-basin/)).

### Facility layout (tank battery, transfer pump, gathering line, SWD)

- Classic lease automation used high-level float controllers in the battery to close lease shut-in valves, which then shut down pumping units at each well ([Southwestern Petroleum Short Course archive](https://www.swpshortcourse.org/ppdl/2129)).
  This is the real-world version of the challenge's "shutdown level".
- Modern SWD and water tanks use submersible pressure transmitters for level, with a PLC that can signal wells to stop when the battery is full ([Banner Engineering](https://www.bannerengineering.com/be/en/solutions/measurement-and-inspection/monitoring-salt-water-disposal-tanks.html)).
- EOG lists "Nearly full" tank alarms and secondary containment on tanks among its spill prevention measures ([EOG 2024 SR](https://eogresources.s3.us-east-2.amazonaws.com/EOG_2024_Sustainability_Report.pdf)).
- Produced water transfer and injection service often uses multistage centrifugal pumps.
  A Saudi Aramco investigation of produced brine injection pumps traced shaft failures to a manufacturing error and long operation at about 125% of best efficiency point, with high bearing vibration and seal leakage before the trip ([Pumps & Systems](https://pumpsandsystems.com/water-injection-pump-shaft-failure-saudi-facility)).
  **Inference:** "pump degradation" in the sim (falling flow, rising vibration or discharge pressure drift) maps to real precursors: off-curve operation, cavitation, seal and bearing wear.
- NGL Energy Partners alone runs over 800 miles of large-diameter produced water pipeline in the northern Delaware Basin ([NGL FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1504461/000150446125000014/ngl-20250331.htm)).

### Recycling

- Estimates of the recycled share vary: 25% to 30% (AOGR) up to 50% to 60% reused for fracking (Texas Living Waters, March 2025), as summarized by [AOGR](https://www.aogr.com/magazine/editors-choice/climbing-water-cuts-produced-water-volumes-create-challenges-in-permian) and [Texas Monthly](https://www.texasmonthly.com/news-politics/permian-fracking-recycling-produced-water/).
  **Unverified:** I did not open the Texas Living Waters report itself.
- Treating for reuse costs about $0.15 to $0.20 per barrel versus $0.25 to $1 for disposal ([JPT](https://jpt.spe.org/twa/balancing-growth-and-risk-why-water-management-is-the-permian-basins-biggest-challenge)).

## 2. EOG Resources specifically

All of the following is from the EOG 2024 Sustainability Report unless another source is named ([PDF](https://eogresources.s3.us-east-2.amazonaws.com/EOG_2024_Sustainability_Report.pdf)).

### Water

- More than 96% of the total water EOG handled in 2024 moved by pipe.
- 72% of water sourced for U.S. operations in 2024 came from reuse or nonfresh sources, and more than 99% in the Delaware Basin.
- Reuse share of water sourced: 46% (2020), 55% (2021), 58% (2022), 57% (2023), 50% (2024).
  Reuse volume was 164 MMbbl in 2024.
- EOG's FY2023 shareholder letter says it "increased water reuse to 90% in the Delaware Basin, our most active operational area" ([EOG FY2023 annual report](https://www.sec.gov/Archives/edgar/data/821189/000119312524080688/d662849dars.pdf)).
- EOG installs pipelines and temporary lay-flat hoses for produced water, builds dual-purpose sourcing and gathering lines, and prioritizes pipe over trucks "to increase water reuse and operational efficiency and reduce the potential for spills".
- It has a Water Resources Team led by a Director of Water Resources who reports up to the COO.
- It piloted thermal evaporation of produced water in 2023 (fewer water trucks, less disposal demand) and expanded mechanical evaporation in 2024.
- **Unverified:** a secondary summary claimed EOG's Delaware reuse system includes nine one-million-barrel reuse pits, five treatment facilities and 27 miles of reuse pipeline; the page I fetched did not contain it.

### Monitoring and software

- Control centers are "continuously staffed to monitor pump volumes, line pressure, sensors, and other operational parameters in our most active operational areas", and staff can "remotely shut down or reroute flow".
- iDetect "integrates sensor data with other operational data to enhance our ability to detect potential leaks in real time at facilities, on flow lines and gathering systems, and in water reuse systems".
- When iDetect sees a potential release, it "sends an alarm notification directly to the mobile devices of our field personnel", including "a description and volume estimate of the potential leak".
- EOG combines "topographic information with sensor data and automated shut-off valves installed on temporary water lines" to prevent spills in its reuse network.
- Trident is a "proprietary desktop and mobile application" with "map-based visualizations of our infrastructure", tracking water availability and demand and supporting "scenario planning for water sourcing, reuse, storage, and transportation", with real-time controls to "anticipate takeaway needs, minimize trucking of water".
- The report also lists "real-time, remote facility monitoring using Supervisory Control and Data Acquisition (SCADA) systems".
- iSense (methane) covered 99% of Delaware Basin gross oil production handled at central tank batteries by year-end 2024, and EOG says an in-house system lets it "own the data".
- In severe weather, EOG can monitor an affected area from a control center and "safely shut down operations".
- EOG's San Antonio Division formed a Spill Prevention Team in 2022 that uses historical incident data "to understand where spills may occur in the future".
- EOG careers material cites 100+ in-house mobile and desktop apps ([EOG careers listing](https://www.justjobs.com/employer/company/2337/Eog-Resources-Inc/1)), up from more than 65 in 2017 ([World Oil 2017](https://www.worldoil.com/magazine/2017/june-2017/columns/drilling-advances)).
- CIO Sandeep Bhakhri's 2017 framing was that EOG owns its data and makes it available "24/7, anytime, anywhere" ([EOG Q1 2017 call transcript](https://roic.ai/quote/EOG/transcripts/2017-year/1-quarter)).

### Spills (EOG U.S. operations)

| Year | Produced water spilled (bbl) | Recovered (bbl) | Oil spills over 1 bbl (count) |
| --- | --- | --- | --- |
| 2024 | 15,387 | 10,945 | 145 |
| 2023 | 13,968 | 7,811 | 199 |
| 2022 | 12,468 | 10,716 | 231 |
| 2021 | 25,304 | 17,558 | 263 |
| 2020 | 14,526 | 8,961 | not given |

Source: data tear sheet in the [EOG 2024 SR](https://eogresources.s3.us-east-2.amazonaws.com/EOG_2024_Sustainability_Report.pdf).
EOG says the 2024 increase came mainly from "increased movement of water resources due to increased operational activity".

## 3. Real costs

| Item | Range | Source and caveat |
| --- | --- | --- |
| Truck a barrel of produced water | about $2.50/bbl | [Wood Mackenzie](https://woodmac.com/press-releases/permian-produced-water), 2018; repeated by [JPT](https://jpt.spe.org/twa/balancing-growth-and-risk-why-water-management-is-the-permian-basins-biggest-challenge) as "as high as $2.50" |
| Move a barrel by pipe | about $0.30/bbl | Wood Mackenzie, 2018 |
| Extra cost of relying on trucks | $1.00 to $1.25/bbl | [NGI citing Wood Mackenzie](https://www.naturalgasintel.com/permian-water-shortages-cited-as-material-risk-to-ep-profits-output/) |
| Midstream gathering plus disposal fee | $0.74/bbl fee, $0.84/bbl with skim oil (2024) | [Aris Water Solutions FY2024 10-K](https://www.sec.gov/Archives/edgar/data/1865187/000155837025001818/aris-20241231x10k.htm) |
| Disposal only | $0.25 to $1/bbl | [JPT](https://jpt.spe.org/twa/balancing-growth-and-risk-why-water-management-is-the-permian-basins-biggest-challenge) |
| Water handling per barrel of oil | $5.11/bbl oil Permian average, $9.44 Delaware (2018) | [Crude Truth summary](https://crudetruth.substack.com/p/the-crude-truth-water-management); **Unverified** original source |
| One Permian truckload, all-in | about $300 | One driver's forum post ([TruckersReport](https://www.thetruckersreport.com/truckingindustryforum/threads/oilfield-pay.337289/)); anecdotal only |
| Challenge sim | $905 per 150 bbl trip (about $6.03/bbl), $60 oil, $3/Mcf gas, 6 h repair | `history/full_week/ops.json` |

- **Shut-in cost.** I found no published per-hour shut-in cost; it depends on the well, which is why the sim computes it from `oil_bpd` and `gas_mcfd`.
  JPT notes shut-in unconventional wells build up downhole water that must be lifted on restart, and restarted wells may show higher water cut ([JPT, June 2020](https://jpt.spe.org/what-damage-wrought-rush-shut-wells)).
  **Inference:** a real shut-in has hidden restart costs the sim ignores, which a pitch can mention as a reason to prefer trucks when costs are close.
- Water disposal issues can shut in wells at scale: a water midstream executive cited one company that shut in almost 100 wells mainly due to disposal problems ([Permian Basin Oil and Gas Magazine](https://pboilandgasmagazine.com/where-will-all-the-water-go/)).
- **Pump repair time.** I could not find a sourced typical repair time for a produced water transfer pump.
  The sim's 6 hours is unverified against real data, so do not present it as an industry figure.

## 4. Real incidents and environmental impact

### Texas

- Inside Climate News analysed RRC logs: more than 10,000 produced water spills and more than 148 million gallons from 2013 to 2022, about 40% recovered, 19 spills over 500,000 gallons, and about 350 that reached streams, rivers or lakes ([ICN](https://insideclimatenews.org/news/31102023/oil-gas-companies-spill-wastewater-in-texas/)).
- ICN also says spills happen "a thousand times a year on average" ([ICN, Dec 2023](https://insideclimatenews.org/news/18122023/state-of-denial-oil-gas-wastewater-spills-texas/)).
- RRC records are not in an easily analysed database, and staff could not say how many of 116 Rule 3.20 violations in FY2022 were produced water ([ICN](https://insideclimatenews.org/news/31102023/oil-gas-companies-spill-wastewater-in-texas/)).
- "Spills of produced water often occur at storage tanks or from pipelines" ([ICN](https://insideclimatenews.org/news/31102023/oil-gas-companies-spill-wastewater-in-texas/)).
- Notable cases, all from the same ICN article:
  - Cimarex, Culberson County, Aug 1, 2017: about 18,000 bbl into the Delaware River after a power loss during a rainstorm; chlorides were 80,000 to 100,000 ppm against EPA's 250 ppm drinking water guideline.
  - Apache, Reeves County, July 29, 2020: a storage tank released 77,500 bbl.
  - Occidental, Gaines County, Nov 2022: over 500,000 gallons from a corroded pipe.
  - Texcel, Knox County: 132 cattle died after contact with spilled produced water.
- **Inference:** the Cimarex case (power loss, then a flow line failure) is a good story for "pump failure plus leak at the same time".

### New Mexico

- More than 700 produced water spills in 2023, per OCD data reported in 2024 ([NM Political Report](https://nmpoliticalreport.com/?p=238670)).
- 846 produced water spills in 2019 totalling nearly 4.4 million gallons ([Ropes Soap n Dope summary of OCD data](https://ropesoapndope.com/spills-related-to-oil-and-gas-declined-in-new-mexico-in-2019)).
- About 26,000 bbl of produced water reported spilled and not recovered in 2021 (OCD handout to the legislature, [nmlegis.gov](https://www.nmlegis.gov/handouts/RHMC%20080522%20Item%204%20OCD%20Produced%20Water%20Management.pdf)).

### Brine damage to soil

- A New Mexico reclamation guide says vegetation recovery after a brine spill may take 3 to 5 years, sandy soils resist damage better, and treatment is gypsum plus freshwater leaching with results after 6 months to 1 year ([OCD record](https://ocdimage.emnrd.nm.gov/imaging/Filestore/SantaFeEnvironmental/AO/20180816/pRAB1704856568_08_16_2018_11_48_05.pdf)).
- High sodium chloride concentrations cause severe vegetation damage and long-lasting soil structure damage ([Rowell and Crepin, CCLM](https://www.cclmportal.ca/sites/default/files/2024-03/Rowell%20and%20Crepin.pdf)).
- At one Oklahoma site with decades of brine discharge, researchers estimated hundreds of years to flush the salt naturally ([AAPG Search and Discovery abstract](https://www.searchanddiscovery.com/abstracts/html/1994/sw/abstracts/0499.htm)).
  **Inference:** "salt does not biodegrade like oil" is a fair one-line contrast for judges.

### Disposal sites and induced seismicity ("the disposal site goes down")

- Gardendale SRA (Midland Basin): in Sept 2021 the RRC asked operators to cut to 10,000 bbl/d across 76 permitted SWD wells, then suspended injection below the top of the Strawn formation effective Dec 31, 2021 ([OGJ](https://ogj.com/exploration-development/article/14222213/west-texas-seismic-activity-constrains-saltwater-well-injection), [Permian Basin Oil and Gas Magazine](https://pboilandgasmagazine.com/commission-suspends-deep-injection-of-produced-water-in-gardendale-sra/)).
- The resulting capacity losses for ConocoPhillips (about 186,000 bbl/d) and a Diamondback subsidiary (about 150,000 bbl/d) were reported by Rystad ([Claims Journal](https://claimsjournal.com/news/southcentral/2022/01/07/307955.htm)).
- From June 1, 2025, new and amended Permian SWD permits face an expanded area of review, surface injection pressure limits and daily volume limits based on reservoir pressure ([RRC press release](https://www.rrc.texas.gov/news/05162025-permian-disposal-wells-guidance-release)).
- New Mexico OCD's Nov 2021 framework triggers monitoring after two M2.5 events within 30 days and 10 miles, and stronger action after an M3.0 or larger ([OCD protocol table](https://www.emnrd.nm.gov/ocd/wp-content/uploads/sites/6/11-23-21-FINAL-NMOCD-Seismic-Mitigation-Protocol-Table.pdf)); in 2024 OCD cancelled dozens of pending disposal permits in the County Line area ([Source NM](https://sourcenm.com/2024/09/12/as-new-mexico-shakes-state-cancels-dozens-of-planned-wastewater-injection-sites/)).
- Overpressure also surfaces as blowouts: a 2022 Crane County well released almost 15 million gallons of brine, and an SMU study linked it to injected wastewater travelling about 12 miles ([ICN](https://insideclimatenews.org/news/11062024/texas-permian-basin-oil-well-water-blowout/), [ICN study coverage](https://insideclimatenews.org/?p=84805)).
  The cause is contested ([Texas Monthly](https://www.texasmonthly.com/news-politics/west-texas-geyser-oil-well-chevron/)).
- **Inference:** the sim's shared disposal site with a fixed `pressure_psi` is a simplification; real SWD capacity can be cut by regulators, which is a good "go further" scenario.

## 5. Regulations and notification

### Texas (RRC)

- 16 TAC 3.20: operators "shall give immediate notice of a fire, leak, spill, or break" to the RRC district office by phone, followed by a letter with the volume lost; the reporting threshold stated is oil loss over five barrels ([Cornell LII](https://www.law.cornell.edu/regulations/texas/16-Tex-Admin-Code-SS-3-20), [RRC](https://rrc.texas.gov/accidents-and-incident-reporting/Oil-and-Gas-Accidents)).
  An overflow counts as a leak under the rule text.
- 16 TAC 3.91: covers crude oil spills in non-sensitive areas; over 5 bbl requires Form H-8, over 25 bbl requires a final cleanup report, and the cleanup level is 1.0% TPH within one year; it does not mention produced water ([Cornell LII](https://www.law.cornell.edu/regulations/texas/16-Tex-Admin-Code-SS-3-91)).
  The Cornell text is labelled effective until 7/1/2025, the date the RRC's rewritten Chapter 4 waste rules took effect ([RRC](https://www.rrc.texas.gov/announcements/02112025-implementation-for-16-tac-chapter-4-new-and-amended-rules)), so check the current version.
- Produced water reporting is murky: RRC District 8 (Midland) told ICN that only produced water spills over 250 bbl must be reported, 2009 draft guidelines say reporting is only "encouraged", and an RRC spokesperson said companies must report ([ICN](https://insideclimatenews.org/news/31102023/oil-gas-companies-spill-wastewater-in-texas/)).
- RRC 24-hour emergency line: 844-773-0305 or 512-463-6788 ([RRC](https://rrc.texas.gov/accidents-and-incident-reporting/Oil-and-Gas-Accidents)).

### New Mexico (OCD, 19.15.29 NMAC)

- A major release is 25 bbl or more (or one that may reach a watercourse); a minor release is over 5 and under 25 bbl ([NMAC via Justia](https://regulations.justia.com/states/new-mexico/title-19/chapter-15/part-29/section-19-15-29-7)).
- Major releases need verbal notice to the OCD district office within 24 hours of discovery plus written notice on form C-141 ([OCD filings](https://ocdimage.emnrd.nm.gov/Imaging/FileStore/SantaFeAdmin/CF/205137/14732_26_CF.pdf)).
  **Unverified:** I did not read the current text of 19.15.29.10 NMAC.

### Leak detection requirements for produced water lines

- I found no federal leak detection requirement for onshore produced water gathering lines.
  A PHMSA letter describes a produced water line within a production flow system as not regulated by PHMSA ([PHMSA](https://www.phmsa.dot.gov/node/56221)); commenters asked PHMSA to cover produced water lines in its hazardous liquid leak detection rulemaking ([PHMSA](https://primis-meetings.phmsa.dot.gov/archive/HL_NPRM_-Feb_1-pre-deliberation.pdf)).
- **Inference:** leak detection on produced water lines is mostly voluntary, operator-driven (like EOG's iDetect), which strengthens the case for a good detector.

## 6. How operators find problems today

- The traditional model is a pumper (lease operator) visiting every well and facility at least daily to check gauges and tanks ([SWPSC paper](https://www.swpshortcourse.org/paper/system-automatic-lease-operation)).
  Job postings describe routes of up to 300 miles a day ([Energy Hire posting](https://app.energyhire.com/job-board/lease-operator-hobbs-nm-35c9bccc-799d-4ae3-ad75-20f26916ab6d)).
- An exception-based surveillance paper estimates one operator can cover 30 to 40 wells instead of 20 with remote monitoring ([SlideShare](https://www.slideshare.net/slideshow/piexception-based-surveillance-wpaperfinal2/43365121)).
  **Unverified:** original venue unknown.
- Before remote level monitoring, field operators drove to the site and climbed the tank to gauge it ([Emerson case study](https://s1-live.emerson.com/documents/automation/case-study-oil-gas-producer-improves-spill-prevention-program-reduces-field-operating-costs-rosemount-en-74536.pdf)).
- Alarm management benchmarks (ISA 18.2 / EEMUA 191, as summarized by Emerson and Chemical Engineering): about 1 alarm per operator per 10 minutes is manageable, and more than 10 in 10 minutes is an alarm flood ([Chemical Engineering](https://www.chemengonline.com/alarm-management-numbers/), [Emerson](https://d1-live.emerson.com/documents/automation/article-alarm-management-by-numbers-deltav-en-38292.pdf)).
  **Inference:** the hard case (2 or 3 pump failures within an hour) is a small alarm flood, so ranking alerts by hours-to-limit is the right design.
- False and nuisance dispatches: no oilfield-specific rate found.
  Cross-industry field service data claims 17% to 25% of truck rolls end "no fault found" ([Blitzz](https://blitzz.co/blog/the-real-cost-of-a-truck-roll-and-how-to-avoid-it)), from vendor sources with an incentive to overstate.
- Vendor case studies claim remote tank monitoring cut a Texas producer's opex by $2M per year ([Emerson](https://emerson.com/documents/automation/case-study-roc800-tank-manager-solution-reduce-opex-by-2m-per-year-en-6863326.pdf)) and emergency dispatches by 28% ([Detechtion](https://www.detechtion.com/hubfs/EZ%20Ops/OnePager_TankManagement_2025.pdf)).
- **Inference:** EOG's stated need (tell a real problem from a bad sensor before sending someone) lines up with cross-checks the sim data supports, for example a tank level rising while pump flow is normal points to a sensor fault, while level rising with pump flow at zero points to a real failure.

## Gaps

- No sourced typical repair time for produced water transfer pumps.
- No current (2025 to 2026) public produced water trucking rate; the $2.50/bbl figure is from 2018.
- No oilfield-specific false alarm rate or cost per unnecessary pumper dispatch.
- No public description of how EOG's control centers triage alarms or staff night shifts.
- Current text of 16 TAC 3.91 after the July 2025 Chapter 4 changes, and of 19.15.29.10 NMAC, not read directly.

## Sources

- EOG 2024 Sustainability Report: https://eogresources.s3.us-east-2.amazonaws.com/EOG_2024_Sustainability_Report.pdf
- EOG FY2023 annual report (shareholder letter): https://www.sec.gov/Archives/edgar/data/821189/000119312524080688/d662849dars.pdf
- EOG careers listing (100+ apps): https://www.justjobs.com/employer/company/2337/Eog-Resources-Inc/1
- World Oil 2017, EOG apps: https://www.worldoil.com/magazine/2017/june-2017/columns/drilling-advances
- EOG Q1 2017 call transcript: https://roic.ai/quote/EOG/transcripts/2017-year/1-quarter
- World Oil 2022, Permian saltwater: https://www.worldoil.com/magazine/2022/july-2022/special-focus-permian-basin-technology-shale-technology/the-great-saltwater-flood-in-the-permian-basin/
- Wood Mackenzie, Permian produced water: https://woodmac.com/press-releases/permian-produced-water
- NGI on Wood Mackenzie: https://www.naturalgasintel.com/permian-water-shortages-cited-as-material-risk-to-ep-profits-output/
- AOGR, climbing water cuts: https://www.aogr.com/magazine/editors-choice/climbing-water-cuts-produced-water-volumes-create-challenges-in-permian
- Texas Tech TAWC 2025 deck: https://www.depts.ttu.edu/tawc/events/water-college/wc2025/leeds.pdf
- AAPG Bulletin 2024: https://archives.datapages.com/data/bulletns/2024/12dec/BLTN24025/bltn24025.html
- KSAT on Texas Produced Water Consortium: https://www.ksat.com/news/texas/2024/12/10/recycled-oilfield-water-could-aid-drought-stricken-west-texas/
- Texas Monthly, recycling: https://www.texasmonthly.com/news-politics/permian-fracking-recycling-produced-water/
- BEG transcript (Scanlon): https://wrp.beg.utexas.edu/script/assessing-potential-for-beneficial-use-of-produced-water-in-the-texas-permian-basin
- Scanlon et al. 2020: https://www.beg.utexas.edu/files/research-study/Will%20Water%20Issues%20Constrain%20Oil%20and%20Gas%20Production%20in%20the%20U_S__.pdf
- JPT, Permian water management: https://jpt.spe.org/twa/balancing-growth-and-risk-why-water-management-is-the-permian-basins-biggest-challenge
- JPT, shut-in wells: https://jpt.spe.org/what-damage-wrought-rush-shut-wells
- Aris Water Solutions FY2024 10-K: https://www.sec.gov/Archives/edgar/data/1865187/000155837025001818/aris-20241231x10k.htm
- NGL Energy Partners FY2025 10-K: https://www.sec.gov/Archives/edgar/data/1504461/000150446125000014/ngl-20250331.htm
- Crude Truth: https://crudetruth.substack.com/p/the-crude-truth-water-management
- TruckersReport forum: https://www.thetruckersreport.com/truckingindustryforum/threads/oilfield-pay.337289/
- Permian Basin Oil and Gas Magazine, water: https://pboilandgasmagazine.com/where-will-all-the-water-go/
- Pumps & Systems, injection pump failure: https://pumpsandsystems.com/water-injection-pump-shaft-failure-saudi-facility
- SWPSC tank battery automation: https://www.swpshortcourse.org/ppdl/2129
- SWPSC automatic lease operation: https://www.swpshortcourse.org/paper/system-automatic-lease-operation
- Banner Engineering, SWD tanks: https://www.bannerengineering.com/be/en/solutions/measurement-and-inspection/monitoring-salt-water-disposal-tanks.html
- Inside Climate News, Texas spills (Oct 2023): https://insideclimatenews.org/news/31102023/oil-gas-companies-spill-wastewater-in-texas/
- Inside Climate News, Texas spills (Dec 2023): https://insideclimatenews.org/news/18122023/state-of-denial-oil-gas-wastewater-spills-texas/
- Inside Climate News, Crane County blowout: https://insideclimatenews.org/news/11062024/texas-permian-basin-oil-well-water-blowout/
- Inside Climate News, SMU study: https://insideclimatenews.org/?p=84805
- Texas Monthly, Crane County geyser: https://www.texasmonthly.com/news-politics/west-texas-geyser-oil-well-chevron/
- NM Political Report: https://nmpoliticalreport.com/?p=238670
- NM 2019 spills summary: https://ropesoapndope.com/spills-related-to-oil-and-gas-declined-in-new-mexico-in-2019
- NM OCD legislative handout 2022: https://www.nmlegis.gov/handouts/RHMC%20080522%20Item%204%20OCD%20Produced%20Water%20Management.pdf
- NM OCD reclamation record: https://ocdimage.emnrd.nm.gov/imaging/Filestore/SantaFeEnvironmental/AO/20180816/pRAB1704856568_08_16_2018_11_48_05.pdf
- Rowell and Crepin, CCLM: https://www.cclmportal.ca/sites/default/files/2024-03/Rowell%20and%20Crepin.pdf
- AAPG abstract, Oklahoma brine: https://www.searchanddiscovery.com/abstracts/html/1994/sw/abstracts/0499.htm
- OGJ, Gardendale: https://ogj.com/exploration-development/article/14222213/west-texas-seismic-activity-constrains-saltwater-well-injection
- Permian Basin Oil and Gas Magazine, Gardendale suspension: https://pboilandgasmagazine.com/commission-suspends-deep-injection-of-produced-water-in-gardendale-sra/
- Claims Journal, disposal closures: https://claimsjournal.com/news/southcentral/2022/01/07/307955.htm
- RRC 2025 Permian disposal guidelines: https://www.rrc.texas.gov/news/05162025-permian-disposal-wells-guidance-release
- NM OCD seismic protocol table: https://www.emnrd.nm.gov/ocd/wp-content/uploads/sites/6/11-23-21-FINAL-NMOCD-Seismic-Mitigation-Protocol-Table.pdf
- Source NM, permit cancellations: https://sourcenm.com/2024/09/12/as-new-mexico-shakes-state-cancels-dozens-of-planned-wastewater-injection-sites/
- 16 TAC 3.20: https://www.law.cornell.edu/regulations/texas/16-Tex-Admin-Code-SS-3-20
- 16 TAC 3.91: https://www.law.cornell.edu/regulations/texas/16-Tex-Admin-Code-SS-3-91
- RRC oil and gas accident reporting: https://rrc.texas.gov/accidents-and-incident-reporting/Oil-and-Gas-Accidents
- RRC Chapter 4 implementation: https://www.rrc.texas.gov/announcements/02112025-implementation-for-16-tac-chapter-4-new-and-amended-rules
- 19.15.29.7 NMAC: https://regulations.justia.com/states/new-mexico/title-19/chapter-15/part-29/section-19-15-29-7
- NM OCD release filing example: https://ocdimage.emnrd.nm.gov/Imaging/FileStore/SantaFeAdmin/CF/205137/14732_26_CF.pdf
- PHMSA letter: https://www.phmsa.dot.gov/node/56221
- PHMSA hazardous liquid NPRM comments: https://primis-meetings.phmsa.dot.gov/archive/HL_NPRM_-Feb_1-pre-deliberation.pdf
- Energy Hire lease operator posting: https://app.energyhire.com/job-board/lease-operator-hobbs-nm-35c9bccc-799d-4ae3-ad75-20f26916ab6d
- Exception-based surveillance paper: https://www.slideshare.net/slideshow/piexception-based-surveillance-wpaperfinal2/43365121
- Emerson spill prevention case study: https://s1-live.emerson.com/documents/automation/case-study-oil-gas-producer-improves-spill-prevention-program-reduces-field-operating-costs-rosemount-en-74536.pdf
- Emerson tank manager case study: https://emerson.com/documents/automation/case-study-roc800-tank-manager-solution-reduce-opex-by-2m-per-year-en-6863326.pdf
- Detechtion tank management: https://www.detechtion.com/hubfs/EZ%20Ops/OnePager_TankManagement_2025.pdf
- Chemical Engineering, alarm management by the numbers: https://www.chemengonline.com/alarm-management-numbers/
- Emerson, alarm management by the numbers: https://d1-live.emerson.com/documents/automation/article-alarm-management-by-numbers-deltav-en-38292.pdf
- Blitzz, truck roll cost: https://blitzz.co/blog/the-real-cost-of-a-truck-roll-and-how-to-avoid-it
