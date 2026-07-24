Snapmaker Luban
===============

Snapmaker Luban is an easy-to-use 3-in-1 software tailor-made for Snapmaker machines.
You can customize the printer settings and control the machine in Luban anytime with ease.
The software also provides G-code generation support for 3D models, laser engraving / cutting, and CNC milling.

Our goal is to provide a multi-functional 3D software, while making it as accessible and customizable as possible for new users / beginners.

**This is a customized version, not the [original authored by Snapmaker](https://github.com/Snapmaker/Luban)**


The software is inspired by [cncjs](https://github.com/cncjs/cncjs) by cheton.
[CuraEngine](https://github.com/ultimaker/curaengine) is used for 3D slicing.

![Software Screenshot](https://github.com/user-attachments/assets/037f108f-fb04-40ef-90d2-234026c52a74)


## How to install and run

### Run released applications

You can download latest releases of software under the ["**Releases**"](https://github.com/rmcc/Luban/releases) section.
It's recommended to use a stable release version unless you want to do some modifications on the source code.

For Linux distros (Debian for example), you may need to run following commands to install dependencies for Luban:

```Bashhist
> sudo dpkg --install snapmaker-luban-{version}-linux-amd64.deb
> sudo apt install --fix-broken
```

### Run from source code

Checkout [Development](./docs/Development.md) to how to run and develop from source code.

## Feedback & Contribution

- To contribute some code, make sure you have read and followed SM's guidelines for [contributing](https://github.com/Snapmaker/Luban/blob/master/CONTRIBUTING.md).

## License
Snapmaker Luban is released under terms of the AGPLv3 License.

Terms of the license can be found in the LICENSE file or at http://www.gnu.org/licenses/agpl-3.0.html.
