'use strict'
require('colors');
const BigNumber = require('bignumber.js');
const FlexContract = require('flex-contract');
const FlexEther = require('flex-ether');
const ethjs = require('ethereumjs-util');
const process = require('process');

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const MAX_UINT256 = new BigNumber(2).pow(256).minus(1).toString(10);

const TOKENS = {
    WETH: '0xc778417e063141139fce010982780140aa0cd5ab',
    WEENUS: '0x101848d5c5bbca18e6b4431eedf6b95e9adf82fa',
    XEENUS: '0x7e0480ca9fd50eb7a3855cf53c347a1b4d6a2ff5',
    YEENUS: '0xF6fF95D53E08c9660dC7820fD5A775484f77183A',
};
const TOKENS_BY_ADDRESS = Object.assign(
    {},
    ...Object.keys(TOKENS).map(k => ({ [TOKENS[k].toLowerCase()]: k })),
);
const ALL_PAIRS = (() => {
    return Object.keys(TOKENS).map((a, i) => {
        return Object.keys(TOKENS).slice(i + 1).map(b => {
            return [`${a}/${b}`, `${b}/${a}`];
        });
    }).flat(2);
})();

const ARGV = require('yargs')
    .option('amount', {
        alias: 'a',
        type: 'number',
        default: 0.01,
    })
    .option('fee', {
        alias: 'f',
        type: 'number',
        default: 0.003,
        choices: [0.0005, 0.003, 0.01],
    })
    .option('sell', {
        alias: 's',
        type: 'string',
        default: 'XEENUS',
        choices: Object.keys(TOKENS),
    })
    .option('buy', {
        alias: 'b',
        type: 'string',
        default: 'WETH',
        choices: Object.keys(TOKENS),
    }).argv;

const ETH = new FlexEther({ providerURI: process.env.NODE_RPC });
const QUOTER = new FlexContract(
    require('../build/IUniswapV3Quoter.output.json').abi,
    '0x2F9e608FD881861B8916257B76613Cb22EE0652c',
    { eth: ETH },
);
const POOL = new FlexContract(
    require('../build/IUniswapV3Pool.output.json').abi,
    NULL_ADDRESS,
    { eth: ETH },
);
const ERC20 = new FlexContract(
    require('../build/IERC20.output.json').abi,
    NULL_ADDRESS,
    { eth: ETH },
);

(async () => {
    if (ARGV.s === ARGV.b) {
        throw new Error(`Cannot quote same token`);
    }
    const sellToken = toTokenContract(TOKENS[ARGV.s]);
    const buyToken = toTokenContract(TOKENS[ARGV.b]);
    const factory = new FlexContract(
        require('../build/IUniswapV3Factory.output.json').abi,
        await QUOTER.factory().call(),
        { eth: ETH },
    );
    const pool = new FlexContract(
        require('../build/IUniswapV3Pool.output.json').abi,
        await factory.getPool(sellToken.address, buyToken.address, encodeFee(ARGV.fee)).call(),
        { eth: ETH },
    );
    const tokens = await Promise.all([
        pool.token0().call(),
        pool.token1().call(),
    ]);
    const r = await QUOTER.quoteExactOutput(
        ethjs.bufferToHex(Buffer.concat([
            ethjs.setLengthLeft(ethjs.toBuffer(buyToken.address), 20),
            ethjs.setLengthLeft(ethjs.toBuffer(encodeFee(ARGV.fee)), 3),
            ethjs.setLengthLeft(ethjs.toBuffer(sellToken.address), 20),
        ])),
        new BigNumber('0.0075e18').toString(10),
    ).call();
    console.log(r);
})().then(() => {
    console.info(`Done!`);
    process.exit();
}).catch(err => {
    console.error(err);
    process.exit(-1);
});

function encodeFee(f) { return Math.floor(f * 1e6); }
function decodeFee(f) { return f / 1e6; }

function toTokenContract(addr) {
    return ERC20.clone({ address: addr });
}
