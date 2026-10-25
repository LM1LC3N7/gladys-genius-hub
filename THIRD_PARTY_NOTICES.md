# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## geniushub-client (manzanotti/geniushub-client)

<https://github.com/manzanotti/geniushub-client>, the Python client of the
Genius Hub API the Genius Hub integration of Home Assistant uses. Version
0.7.4 (`master` at commit 2b182e5, 2026-04-20). Its `LICENSE` file is the
MIT template with the placeholder name "The Python Packaging Authority",
reproduced below as it appears in the repository.

Ported to JavaScript in `src/client.js`, `src/model.js` and
`src/constants.js`: the local API v3 of the hub (`http://<hub>:1223/v3/`,
`GET zones`, `GET data_manager`, `GET auth/release`, `PATCH zone/<id>`), the
login sent as HTTP Basic with the user name and the SHA-256 (hex) of user
name + password, the `Connection: close` header, the zone types, modes and
equipment flags (`iType`, `zoneSubType`, `iMode`, `iFlagExpectedKit`), the
device tree of `data_manager` (sites, nodes, channels, `_cfg`), the channel
names (`Battery`, `TEMPERATURE`, `HEATING_1`, `LUMINANCE`, `Motion`,
`SwitchBinary`, `lastComms`), the table of device models by hash, the bodies
of `set_mode` (`{ iMode }`) and `set_override` (`{ iMode: 16, fBoostSP,
iBoostTimeRemaining }`). The test answers in `test/fixtures/genius.js` are
shaped after the tests of the library. Changed here: values are read against
strict patterns and bounds, every answer is bounded in size and time, the
hub's unique id is checked before the values are published, the commands are
decided on a fresh read and bounded. The cloud API v1 (my.geniushub.co.uk),
the schedules (timer and footprint), the issues as entities and the
occupancy heuristics of the web application are not ported.

Its license, reproduced as it appears in the repository:

```
MIT License

Copyright (c) 2019 The Python Packaging Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-iskra, gladys-compit

The `/data` store (`src/store.js`), the address parser (`src/config.js`),
the bounded HTTP read, the pace of the reads with one clock read per
decision, the test helpers (virtual clock, fake network) and the shape of
the commands (fresh read, `beforeSend`, the protective command outside the
queue, the sticky guard) come from the sibling integrations
[gladys-iskra](https://github.com/LM1LC3N7/gladys-iskra) and
[gladys-compit](https://github.com/LM1LC3N7/gladys-compit), same project,
Apache-2.0.
