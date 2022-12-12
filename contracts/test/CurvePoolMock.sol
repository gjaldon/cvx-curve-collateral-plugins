// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "../PoolTokens.sol";

contract CurvePoolMock is ICurvePool {
    uint[] internal _balances;
    address[] public coins;

    constructor(uint[] memory intialBalances, address[] memory _coins) {
        _balances = intialBalances;
        coins = _coins;
    }

    function setBalances(uint[] memory newBalances) external {
        _balances = newBalances;
    }

    function balances(uint index) external view returns (uint256) {
        return _balances[index];
    }

    function get_virtual_price() external pure returns (uint256) {
        return 1;
    }

    function token() external pure returns (address) {
        return address(0);
    }

    function exchange(int128, int128, uint256, uint256) external {}
}
