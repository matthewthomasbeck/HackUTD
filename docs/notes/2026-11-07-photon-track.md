# Photon sponsor track, 2026-11-07

Status: DROPPED later on 2026-11-07 (Cayden: too much work and too many edge cases); SpacetimeDB is a target track again.
This file is history.

## Challenge statement

Not recorded yet.
Add the slide text here (challenge, requirements, judging, prizes, what Photon's product is) before building the Photon part.

## Team plan (Cayden, 2026-11-07)

Photon calls everyone: residents in the affected area and their opt-in contacts, to find out who is safe, who needs help, and who is missing.
The answers become person reports and survivor leads on the shared board.
This replaces the Twilio text check-in plan from earlier the same day, unless Photon's product turns out to be text only or needs Twilio underneath.

## Open questions

- What Photon's product is and what the challenge asks for.
- Whether Photon handles the phone calls itself (voice agent, telephony) or needs a carrier such as Twilio.
- Accounts, API keys, and trial limits.
- Standard Response (a Cal Hacks 13.0 winner) already built AI calls for evacuations, so the pitch should tie the calls to the robot search and the "no one overlooked" board instead of copying that product.

## "How do you reach people who are not State Farm customers?"

Prepared answer (Cayden asked, 2026-11-07).
We do not collect phone numbers of people who did not opt in, and we do not need to.
Four channels cover everyone, and the robot covers whoever none of them reach:

1. Opt-in lists we are allowed to use: State Farm policyholders' opt-in contacts, a city or county opt-in alert registry (many local governments run opt-in emergency alert sign-ups; a real deployment would partner with them), and apartment managers' tenant contacts.
2. Inbound calls: the system's Photon number is broadcast through public channels (emergency alerts, local news, social media, signs at shelters), so anyone can call or text in to say they are safe or that someone is missing.
   This reaches people whose numbers we never had.
3. Neighbors: every call asks "Is anyone near you who may not be able to get out?", and those answers become leads (Standard Response used the same idea).
4. Official reverse-911 and wireless emergency alerts belong to government agencies; we would integrate as a partner, not copy their data.

Whoever is not reached by any channel is the point of the robot: a household with no answer and no report moves up the robot's search list, so being unreachable by phone makes a home more likely to be searched, not less.
Never: scraped data, people-search sites, or buying phone lists.
