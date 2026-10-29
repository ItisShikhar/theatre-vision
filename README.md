# Theatre Vision

![Theatre Vision logo](./assets/logo_sm.png)

Theatre Vision expands HTML5 and embedded videos to fill the page. It keeps native player controls and captions.

![Theatre Vision toolbar popup](./screenshots/popup.png)

![Theatre Vision site rules](./screenshots/site-rules.png)

## Features

- Toggle theatre mode for the active site from the toolbar.
- Add or remove blocked domains and allowed subdomains. Changes save automatically.
- Press `Esc` to exit theatre mode.

The most specific matching domain rule wins. Add `video.example.com` under allowed subdomains to override a block for `example.com`.

## Languages

The popup, site rules, and video controls use the browser language. Supported languages include English, Hindi, Spanish, Japanese, Korean, French, Portuguese, Bengali, Malayalam, German, Simplified Chinese, Arabic, and Russian.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder.

## Use

1. Open a site with a video.
2. Select the Theatre Vision toolbar icon.
3. Turn theatre mode on or off for that site.
4. Select **Manage** to edit site rules. Changes save when you add or remove a domain.
5. Hover over a video and select the theatre control.

## Author

Made by [Shikhar Srivastava](https://www.linkedin.com/in/itisshikhar).

[GitHub](https://github.com/ItisShikhar) · [Source code](https://github.com/ItisShikhar/theatre-vision)

## Project files

- Extension code and pages are in `src/`.
- Brand images are in `assets/`.
- Chrome locale catalogs remain in `_locales/`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you propose a change. Follow
the [Code of Conduct](./CODE_OF_CONDUCT.md) in project discussions.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
