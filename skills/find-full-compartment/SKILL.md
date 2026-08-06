---
name: find-full-compartment
description: Find fully free compartments on Russian trains over a date range through the RZD MCP server, and show the carriage drawing with those berths marked. Use whenever someone asks for a whole compartment, an entire empty compartment, four berths together behind one door, a family compartment, or the nearest date with a full compartment between two stations - including terse requests such as "Москва → Владивосток, полное купе, с 1 по 30 сентября" or "целое купе на четверых во Владивосток в сентябре, с картинкой".
---

# Find a full train compartment

## Reading the request

A request names a direction, a period and sometimes a party size: "Москва →
Владивосток, полное купе, с 1 по 30 сентября 2026 с картинкой" carries all
three. Fill the rest in yourself and say what you assumed - do not interrogate
the traveller for parameters that have an obvious default.

- **Party size.** "Полное купе", "целое купе", "купе целиком" mean four berths
  unless a number is given. "СВ" or "купе на двоих" means two: pass it as
  `places`, because a two-berth carriage has two berths behind its door and four
  would never be confirmed there.
- **Period.** Convert to an inclusive ISO range. A bare month means the whole
  month, "ближайшие даты" means from today. Ranges are capped at 31 days: if a
  longer one is asked for, search the first 31 days and say the range was cut.
- **Drawing.** Show it by default for the best match. "С картинкой", "покажи
  схему", "где именно места" all confirm it; only skip it if the traveller asks
  for text alone.

Ask a question only when the direction is genuinely ambiguous - "Владивосток"
resolves to two station codes, so `find_stations` first and pick or ask.

## Answering

1. Call `search_full_compartments` once with the direction, the ISO range and
   `places`.
2. Report only `confirmed` entries as a compartment. Each carries the car and
   compartment number and the exact berths the carriage response listed inside
   that compartment.
3. Never promote a `candidates` entry. A candidate is a carriage with enough
   free berths that the API did not confirm as one compartment, and its `reason`
   says why:
   - `places_not_in_one_compartment` - the berths sit in different compartments;
     offer them as separate seats, never as a compartment;
   - `compartment_layout_missing` - the response carried no compartment
     breakdown; say the compartment could not be confirmed.
   When nothing is confirmed, say so plainly and offer the candidates as what
   they are, or suggest widening the range.
4. Earliest dates first. Give train, local departure and arrival, car,
   compartment, berths, service class, price per berth and total.
5. Keep the berth markers exactly as returned: `36Ж` is a berth in a women-only
   compartment, `6С` one in a mixed compartment. The traveller sees these on the
   ticket, so never strip them to the bare number - and mention what the marker
   means, since a women-only compartment changes who can travel there.
6. For the best match, call `get_car_scheme` with that car's metadata from
   `get_carriages`, `include_image: true` and the compartment's berths in
   `free_places`. Without `free_places` every berth stays the same near-white
   and the drawing reads as an empty carriage. The reply carries a PNG of about
   60 KB; `imageUrls` also holds a link to the original drawing.
7. State the `checkedAt` timestamp and warn that availability and prices change
   in real time.
8. Report every entry in `errors` and every date in `unchecked` as a date that
   was not searched, never as a date with no compartments. `unchecked` means the
   scan hit its request budget; offer to continue from the first date in it.
9. Never claim to reserve or buy tickets; point to an authorized RZD sales
   channel.
