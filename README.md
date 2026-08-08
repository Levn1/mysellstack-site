# MySellStack Appointments — marketing & help site

Static site, no build step: plain HTML + one stylesheet
(`css/site.css`). Every page works from any host root or subpath —
all links are relative.

## Structure

```
index.html            homepage
404.html              not-found page (GitHub Pages picks it up automatically)
help/index.html       help center: article directory + contact form
help/*.html           nine how-to / troubleshooting articles
assets/               screenshots (captured from the live app)
css/site.css          the entire design system
.nojekyll             tells GitHub Pages to serve files as-is
```

## Hosting on GitHub Pages

1. Create a GitHub repository and push this folder to it.
2. Repo → Settings → Pages → Source: **Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`. Relative
   links mean the subpath just works.
4. Custom domain later: add the domain in the same Pages settings and
   point DNS at GitHub; nothing in the site needs to change.

## The contact form

`help/index.html` posts to `https://appointments.mysellstack.com/contact`
— an endpoint in the app itself (route `app/routes/contact.jsx` in the
app repo). It validates, rate-limits by IP, drops honeypot spam, and
relays the message to the `SUPPORT_INBOX` Fly secret with reply-to set
to the sender. The static site needs no backend of its own.

## Updating screenshots

Captures come from the live admin/storefront via the CDP harness in the
app repo's session scratchpad (`s1-shots.mjs`, `h2-help.mjs` and
friends). Keep crops tight, add the orange highlight ring for
"click here" shots, and downscale to ≤1280 px wide (`sips -Z 1280`).
