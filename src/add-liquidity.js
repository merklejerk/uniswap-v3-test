'use strict'
require('colors');
const BigNumber = require('bignumber.js');
const FlexContract = require('flex-contract');
const FlexEther = require('flex-ether');
const ethjs = require('ethereumjs-util');

const SENDER_KEY = ethjs.keccak256(Buffer.from('notmykeys'));
const SENDER_ADDRESS = ethjs.toChecksumAddress(
    ethjs.bufferToHex(ethjs.privateToAddress(SENDER_KEY)),
);
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
    .option('pair', {
        alias: 'p',
        type: 'string',
        default: 'WETH/WEENUS',
        choices: ALL_PAIRS,
    })
    .option('fee', {
        alias: 'f',
        type: 'number',
        default: 0.003,
        choices: [0.0005, 0.003, 0.01],
    })
    .option('tick-delta', {
        alias: 't',
        type: 'number',
        default: 0,
    }).argv;

const ETH = new FlexEther({ providerURI: process.env.NODE_RPC });
const FACTORY = new FlexContract(
    require('../build/IUniswapV3Factory.output.json').abi,
    '0xb31b9A7b331eA8993bdfC67c650eDbfc9256eC62',
    { eth: ETH },
);
const POOL = new FlexContract(
    require('../build/IUniswapV3Pool.output.json').abi,
    NULL_ADDRESS,
    { eth: ETH },
);
const POSITION_MANAGER = new FlexContract(
    require('../build/IUniswapV3PositionManager.output.json').abi,
    '0x29e4bF3bFD649b807B4C752c01023E535094F6Bc',
    { eth: ETH },
);
const WETH = new FlexContract(
    require('../build/IWETH.output.json').abi,
    TOKENS.WETH,
    { eth: ETH },
);
const WEENUS = new FlexContract(
    require('../build/ITestToken.output.json').abi,
    TOKENS.WEENUS,
    { eth: ETH },
);

(async () => {
    console.info(`Sender: ${SENDER_ADDRESS.bold.green}`);
    const pair = getTokens(ARGV.pair);
    const pool = await createPool(pair, ARGV.fee);
    const poolInfo = await getPoolInfo(pool);
    await addLiquidity(
        poolInfo, ARGV.amount,
        ARGV.tickDelta,
    );
})();

function getTokens(pair) {
    return pair.split('/')
        .map(n => TOKENS[n])
        .sort((a, b) => new BigNumber(a.toLowerCase())
            .comparedTo(new BigNumber(b.toLowerCase())))
        .map(a => toTokenContract(a));
}

async function createPool(pair, fee) {
    const pairName = pair.map(p => TOKENS_BY_ADDRESS[p.address.toLowerCase()]).join('/');
    let poolAddress = await FACTORY.getPool(
        ...pair.map(p => p.address),
        encodeFee(fee),
    ).call();
    if (poolAddress === NULL_ADDRESS) {
        console.info(`No pool for ${pairName.bold} with fee ${fee.toString().bold} exists. Creating one...`);
        const r = await FACTORY.createPool(
            ...pair.map(p => p.address),
            encodeFee(fee),
        ).send({ key: SENDER_KEY });
        poolAddress = r.findEvent('PoolCreated').args.pool;
        console.info(`Created pool ${poolAddress.bold}`);
    } else {
        console.info(`Found existing pool for ${pairName.bold} at ${poolAddress.bold}`);
    }
    const pool = POOL.clone({ address: poolAddress });
    if (!(await pool.slot0().call()).unlocked) {
        const price = await getDefaultPriceForPair(pair);
        console.info(`Initializing pool with 1:1 price (${price.yellow})...`);
        await pool.initialize(toSqrtPriceX96(price)).send({ key: SENDER_KEY });
        console.info(`Pool initialized!`);
    } else {
        console.info(`Pool is already initialized`);
    }
    return pool;
}

function encodeFee(f) { return Math.floor(f * 1e6); }
function decodeFee(f) { return f / 1e6; }
const X96 = new BigNumber(2).pow(96);
function toSqrtPriceX96(price) {
    return X96
        .times(new BigNumber(price).sqrt())
        .integerValue(BigNumber.FLOOR)
        .toString(10);
}
function fromSqrtPriceX96(sqrtPriceX96) {
    return new BigNumber(sqrtPriceX96)
        .div(X96)
        .pow(2)
        .toString(10);
}

function toTokenContract(addr) {
    return addr.toLowerCase() == TOKENS.WETH.toLowerCase()
        ? WETH : WEENUS.clone({ address: addr });
}

function priceToTick(price) {
    price = new BigNumber(price).toNumber();
    return Math.floor(Math.log(price) / Math.log(1.0001));
}

function tickToPrice(tick) {
    return 1.0001 ** tick;
}

// Create a price for token1(1) / token0(1)
async function getDefaultPriceForPair(pair) {
    const [decimals0, decimals1] = await Promise.all(pair.map(async t => t.decimals().call()));
    return new BigNumber(`1e${decimals1}`).div(`1e${decimals0}`).toString(10);
}

async function getPoolInfo(pool) {
    const [
        token0,
        token1,
        tickSpacing,
        fee,
        slot0,
    ] = await Promise.all([
        (async () => await pool.token0().call())(),
        (async () => await pool.token1().call())(),
        (async () => parseInt(await pool.tickSpacing().call()))(),
        (async () => decodeFee(await pool.fee().call()))(),
        (async () => await pool.slot0().call())(),
    ]);
    return {
        pool,
        tickSpacing,
        fee,
        pair: [toTokenContract(token0), toTokenContract(token1)],
        price: fromSqrtPriceX96(slot0.sqrtPriceX96),
        tick: parseInt(slot0.tick),
        unlocked: slot0.unlocked,
    };
}

function alignTick(tick, tickSpacing) {
    const d = tick % tickSpacing;
    if (d < 0) {
        return tick - (tickSpacing + d);
    }
    return tick - d;
}

async function addLiquidity(poolInfo, amount, tickDelta) {
    const priceTick = alignTick(poolInfo.tick, poolInfo.tickSpacing);
    const price = tickToPrice(priceTick);
    const tickLow = priceTick + (ARGV.tickDelta - 1) * poolInfo.tickSpacing;
    const tickHigh = priceTick + (ARGV.tickDelta + 1) * poolInfo.tickSpacing;
    const [decimals0, decimals1] = await Promise.all([
        poolInfo.pair[0].decimals().call(),
        poolInfo.pair[1].decimals().call(),
    ]);
    const token0Amount = new BigNumber(amount)
        .times(`1e${decimals1}`)
        .div(price)
        .integerValue(BigNumber.ROUND_DOWN)
        .toString(10);
    const token1Amount = new BigNumber(amount)
        .times(`1e${decimals0}`)
        .times(price)
        .integerValue(BigNumber.ROUND_DOWN)
        .toString(10);
    await mint(poolInfo.pair[0], token0Amount);
    await mint(poolInfo.pair[1], token1Amount);
    await approve(poolInfo.pair[0], POSITION_MANAGER.address, token0Amount);
    await approve(poolInfo.pair[1], POSITION_MANAGER.address, token1Amount);
    console.info(
        `Adding liquidity at mid price ${price.toString().yellow} from` +
        ` ${tickToPrice(tickLow).toString().yellow} (${tickLow}) -> ` +
        `${tickToPrice(tickHigh).toString().yellow} (${tickHigh})` +
        ` to pool ${poolInfo.pool.address.bold}...`,
    );
    const r = await POSITION_MANAGER.mint({
        token0: poolInfo.pair[0].address,
        token1: poolInfo.pair[1].address,
        fee: encodeFee(poolInfo.fee),
        tickLower: tickLow,
        tickUpper: tickHigh,
        amount0Desired: token0Amount,
        amount1Desired: token1Amount,
        amount0Min: 0, // token0Amount,
        amount1Min: 0, // token1Amount,
        recipient: SENDER_ADDRESS,
        deadline: Math.floor((Date.now() / 1000) + 600), // + 10m
    }).send({ key: SENDER_KEY, gas: 1e6 });
}

async function mint(token, amount) {
    let bal = await token.balanceOf(SENDER_ADDRESS).call();
    while (new BigNumber(bal).lt(amount)) {
        console.info(`Minting ${TOKENS_BY_ADDRESS[token.address.toLowerCase()].bold}...`);
        if (token.drip) {
            await token.drip().send({ key: SENDER_KEY });
            bal = await token.balanceOf(SENDER_ADDRESS).call();
        } else {
            const needed = new BigNumber(amount).minus(bal).toString(10);
            await token.deposit().send({ key: SENDER_KEY, value: needed });
            break;
        }
    }
}

async function approve(token, spender, minAmount) {
    const allowance = await token.allowance(SENDER_ADDRESS, spender).call();
    if (new BigNumber(allowance).lt(minAmount)) {
        console.info(`Approving ${spender.bold} to spend token ${TOKENS_BY_ADDRESS[token.address.toLowerCase()].bold}...`);
        await token.approve(spender, MAX_UINT256).send({ key: SENDER_KEY });
    }
}
