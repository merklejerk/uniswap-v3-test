// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8;

interface IERC20 {
    function decimals() external view returns (uint8);
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface ITestToken is IERC20 {
    function drip() external;
}
