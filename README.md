# work-map

Your work as a map: every project, client, deal and campaign, how they connect, and how it all grew, month by month. Explore it, then download it as a video to post.

It works for developers (GitHub, local git repos), salespeople (CRM deals, meetings, LinkedIn, sent email) and marketers (campaigns, ads), or any mix of them. Every source is read on your device.

![The map](docs/map.png)

![Frames from the video](docs/video-frames.png)

**Try it in your browser:** [slatermarketing.co.uk/work-map](https://slatermarketing.co.uk/work-map). Connect GitHub, type a username, or add your exports.

**Or run it on your own machine**, from the git repos on your computer, with no sign-in:

```sh
npx github:SlaterMarketing/work-map ~/code
```

It writes `work-map.html`. Open it in Chrome, Edge or Safari.

## Sources

| Source | How to get it | What it adds |
|---|---|---|
| GitHub | Sign in on the website, or a username for public repos | projects, commits by month, links from shared names, READMEs and dependencies |
| Local git repos | the CLI | the same, with no sign-in |
| Calendar | Google Calendar: Settings → Import & export → Export (.zip). Outlook and Apple Calendar: export .ics | companies you met at least twice, and meetings by month |
| CRM deals | Export deals as CSV from HubSpot, Pipedrive, Salesforce, Close, Zoho… | companies, deals worked, deals won and revenue by month, grouped by industry or pipeline if the export has one |
| LinkedIn | Settings → Data privacy → Get a copy of your data → Connections (arrives in about 10 minutes) | new connections by month, and the companies where you know three or more people |
| Sent email | [The Gmail script](extras/gmail-sent-by-domain.gs): run it in your own Google account, download the sheet it makes as CSV | emails you sent to each company, by month. Only counts leave Gmail. |
| Campaigns | Export campaigns as CSV from Mailchimp, Klaviyo, HubSpot… | campaigns and marketing emails sent, by list |
| Ads | A campaign report by day or month from Google Ads, Meta, LinkedIn Ads… | campaigns and ad spend |
| Anything else | Any sheet with a date column and a client, company, project or campaign column (and optionally a count or hours) | one activity per row |

The same company from different sources becomes one node: "Northwind Traders Ltd" in the CRM, northwind.com in your calendar and Northwind Traders on LinkedIn are joined up, so a company shows the meetings, emails, deals and connections behind it.

Why a script for Gmail? Any website that reads Gmail, even just who you emailed, has to pass Google's yearly security audit. A script you run in your own account doesn't, and you can read every line of it first.

## What it shows

- **Projects** (filled circles): your repos, sized by how much you've done on them.
- **Clients or companies** (rings): from your calendar, CRM, LinkedIn or email.
- **Links** between them:
  - a shared name, like `orbit-api` and `orbit-web`
  - a client's name in a project's name or description
  - one project naming another in its README or `package.json`
  - a shared stack: the same dependencies and topics (dashed)
- **Families**: groups of linked projects and clients, each with its own colour.
- **The timeline**: things appear when you first worked on them, and pulse in the months you were busy with them.

The video is the timeline played out, with the month, running totals and captions for each year, in vertical (9:16), square or landscape (16:9). The totals are whichever your data has, most telling first: deals won, revenue, meetings, commits, emails sent, campaigns, marketing emails, ad spend, connections.

## Private by default

- **Nothing is uploaded.** The CLI only reads files on your computer. In the browser, your repos are read straight from GitHub by your browser, and the video is made in your browser too.
- **Anonymous labels are on by default.** Clients become "Client A", private repos become "TypeScript project", and families named after something private become "Product A". Public repos keep their names. Edit any label, or hide anything, before you download.
- The CLI's HTML file has no local paths in it. It does contain your repo and client names, so that you can switch between real and anonymous labels. Share the video, not the HTML file.

## CLI

```
work-map [folders...] [options]

  --author <email>   your commit email; repeat for more (default: git config user.email)
  --ics <file>       calendar export (.ics, or Google Calendar's .zip) to add clients; repeatable
  --csv <file>       a CSV export (CRM, LinkedIn, campaigns, ads, the Gmail sheet, any sheet); repeatable
  --name <name>      the name on the video (default: git config user.name)
  --out <file>       where to write the map (default: work-map.html)
  --json <file>      also write the data as JSON
  --depth <n>        how many folders deep to look for repos (default: 3)
  --since <YYYY-MM>  start the timeline here
  --real-names       start with real labels instead of anonymous ones
```

It looks in every branch and counts each commit once, so a repo copied from another doesn't count its history twice.

With only `--csv` and `--ics`, it doesn't look for repos at all:

```sh
npx github:SlaterMarketing/work-map --csv deals.csv --csv Connections.csv --ics calendar.zip
```

To add clients, export your calendar. In Google Calendar that's Settings → Import & export → Export, which gives you a .zip. Outlook and Apple Calendar can export .ics files.

## Use it in your own page

```sh
npm install github:SlaterMarketing/work-map
```

```js
import { collectGitHub, clientsFromCalendar, importTable, combineSources, mountStudio } from 'work-map';

const data = combineSources([
  { type: 'github', ...(await collectGitHub({ user: 'octocat' })) },   // or { token } for private repos
  { type: 'calendar', items: clientsFromCalendar(icsText).items },
  importTable(dealsCsv),                                               // returns its own type
]);
mountStudio(document.getElementById('app'), data, { credit: 'Made with work-map' });
```

Or with a script tag, after `npm run build`: `dist/work-map.js` puts everything on `window.WorkMap`.

The pieces, if you want to build your own interface:

| | |
|---|---|
| `collectGitHub({ token, user, onProgress })` | Data from GitHub. With a token it reads every repo the token can see; without one it reads a user's 20 most recently active public repos (GitHub allows 60 requests an hour without signing in). |
| `clientsFromCalendar(texts, { ownDomains })` | Client items from .ics text. `icsFromZip(buffer)` unpacks Google's export. |
| `importTable(csvText, filename)` | Items from a CSV export, recognised from its columns. Throws a readable error if it can't tell what the file is. |
| `combineSources(sources)` | One data set from several sources, with the same company joined up and the right words ("companies", "channels"). |
| `GMAIL_SCRIPT` | The Gmail script's source, to show or copy. |
| `buildGraph(data, { labels, hidden })` | Families, links and the layout. Same data, same map, every time. |
| `anonymousLabels(graph)` | Label overrides that hide clients and private work. |
| `mountMap(el, graph)` | The interactive map on its own. |
| `createVideo(graph, { format })` | The video: `draw(ctx, frame)` draws any frame. |
| `exportVideo(video)` | Encodes it as MP4 (H.264) with WebCodecs, or WebM where the browser can't do H.264. |

### The data format

```js
{
  version: 1,
  name: 'Sam Rivera',
  generated: '2026-10-28',          // the last month shown
  items: [
    { id: 'gh:sam/orbit-api', label: 'orbit-api', kind: 'project', language: 'TypeScript', public: false,
      tags: ['express', 'prisma'], series: { commits: { '2024-03': 41, '2024-04': 18 } } },
    { id: 'cal:northwind.io', label: 'Northwind', kind: 'client', domain: 'northwind.io',
      series: { meetings: { '2024-03': 3 } } },
  ],
  links: [{ source: 'gh:sam/orbit-api', target: 'cal:northwind.io', kind: 'client', weight: 0.7 }],
}
```

Series can be any of `deals`, `revenue`, `opportunities`, `meetings`, `commits`, `emails`, `campaigns`, `sends`, `spend`, `posts`, `connections` and `activities` (see `src/series.js` for how each sizes a node and what the video calls it). Anything else you can count by month works too, so you can add sources of your own. Top-level `series` holds counts that belong to no node (all your LinkedIn connections, say), `currency` is used for revenue and spend, and `terms` names the two kinds of node.

`examples/` has made-up data: `sample.json` (a developer), and a salesperson-and-marketer's exports (`hubspot-deals.csv`, `linkedin-Connections.csv`, `mailchimp-campaigns.csv`, `google-ads.csv`, `sales-calendar.ics`) combined in `sales-sample.json`.

## Developing

```sh
npm install
npm test               # unit tests
npm run build          # dist/work-map.js
node scripts/demo.mjs [sales-sample.json]  # examples/*-demo.html, from the sample data
```

`node scripts/check.mjs <dir>` opens the demo in Chrome, saves screenshots and video frames to `<dir>`, and times a full video export.

## Licence

MIT. Made by [Will Slater](https://slatermarketing.co.uk).
