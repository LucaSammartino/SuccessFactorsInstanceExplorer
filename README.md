# SuccessFactors Instance Explorer

A simple local app for exploring SAP SuccessFactors configuration exports.

Create a project, choose the folder that contains your exports, and the app
builds a visual map of your instance: objects, permissions, workflows, business
rules, and OData links.

## Why Use It?

- See how your SuccessFactors setup is connected.
- Compare projects or instances.
- Review permissions and workflows without digging through many export files.
- Keep everything on your own computer.

## Start

```bash
npm install
npm --prefix ui install
npm run server
```

Open `http://127.0.0.1:5174`.

## Privacy

Your files stay local. The app runs on your computer, stores project data in the
gitignored `projects/` folder, and does not send your exports to a cloud service.

Do not import employee records, payroll data, or other personal data. This app is
for configuration exports only.

## License

MIT. This project is independent and is not affiliated with, endorsed by, or
supported by SAP.
