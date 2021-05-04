'use strict'
require('colors');
const BigNumber = require('bignumber.js');
const FlexContract = require('flex-contract');
const FlexEther = require('flex-ether');
const ethjs = require('ethereumjs-util');
const process = require('process');

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';


const ETH = new FlexEther({ providerURI: process.env.NODE_RPC });
const ROUTER = new FlexContract(
    require('../build/IUniswapV3Router.output.json').abi,
    '0x71bB3d0e63f2Fa2A5d04d54267211f4Caef7062e',
    { eth: ETH },
);
const ERC20 = new FlexContract(
    require('../build/IERC20.output.json').abi,
    NULL_ADDRESS,
    { eth: ETH },
);

(async () => {
    const e = await ROUTER.exactInput({
        path: '0x7e0480ca9fd50eb7a3855cf53c347a1b4d6a2ff5000bb8c778417e063141139fce010982780140aa0cd5ab',
        recipient: '0x2621ea417659Ad69bAE66af05ebE5788E533E5e7',
        deadline: Math.floor(Date.now() / 1000 + 24 * 60 * 60),
        amountIn: '10000000000000000',
        amountOutMinimum: '1',
    }).encode();
    console.log(e);
})().then(() => {
    console.info(`Done!`);
    process.exit();
}).catch(err => {
    console.error(err);
    process.exit(-1);
});
