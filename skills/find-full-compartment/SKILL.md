---
name: find-full-compartment
description: Find fully available four-seat compartments on Russian trains over a date range using the RZD MCP server. Use for requests to find an entire empty compartment, four seats together in one compartment, family compartment availability, or the nearest date with a full compartment between two stations.
---

# Find a full train compartment

1. Resolve ambiguous station names with the MCP `find_stations` tool.
2. Call `search_full_compartments` once with station names or resolved codes and
   an inclusive ISO date range. Keep ranges at 31 days or less.
3. Report only `confirmed` entries as a full compartment. Each one carries the
   car and compartment number and the exact places the carriage response listed
   inside that compartment.
4. Never promote a `candidates` entry to a full compartment. A candidate is a
   carriage with enough free places that the API did not confirm as one
   compartment, and its `reason` says why:
   - `places_not_in_one_compartment` — the free places sit in different
     compartments; offer them as separate seats, not as a compartment;
   - `compartment_layout_missing` — the response carried no compartment
     breakdown; say the compartment could not be confirmed.
5. Present the earliest matching dates first. Include train, local departure and
   arrival, car, compartment, places, service class, and estimated total price.
   Keep the place markers as returned: `36Ж` is a berth in a women-only
   compartment and `6С` one in a mixed compartment - the passenger sees these on
   the ticket, so never strip them down to the bare number.
6. For a compartment worth booking, call `get_car_scheme` for that car and give
   the `imageUrls` link so the traveller can see which berths sit behind one
   door. Pass `include_image` when the reply should show the drawing itself,
   with the compartment's places in `free_places` so they are filled blue - an
   unpainted drawing shows every berth in the same near-white and reads as
   empty. It arrives as a PNG of roughly 60 KB per carriage.
7. State the `checkedAt` timestamp from the response and warn that availability
   and prices change in real time.
8. Report every entry in `errors` as a date that was not checked, rather than as
   a date with no compartments.
9. Never claim to reserve or purchase tickets; direct the user to verify and buy
   through an authorized RZD sales channel.
