Multi-Sig Wallet Hack
===================


이틀전 Ethereum 과 관련하여 이슈가 하나 있었다.  

Parity의 다중서명 지갑의 Smart Contract 보안 취약성을 이용해 해커가 Ether를 훔쳐가는 사건이 일어났다. [Parity blog 관련 링크](https://blog.parity.io/the-multi-sig-hack-a-postmortem/)

작년에도 비슷한 시기에 DAO 사건이 있었지만, 이번 기사를 보면서 드는 생각들을 적어본다.
<br><br>
한마디로 요약하면, **Parity의 다중서명 Smart Contract 지갑의 Bug** 

<br>
#### **[Parity](https://parity.io/parity.html)** 에 대해서
> Ethereum Client 중 하나!
<br>
cf. go-ethereum, pyethapp, cpp-ethereum, ethereumj...
<br>
<br>
언어별 Ethereum Client의 특성이 있고, rust로 개발 (부연설명)
<br>
<br>
Dr. Gavin이 만든 회사 (Ethereum Foundation 멤버였는데...)

<br>


### 무슨 일이 일어난 것인가?
**Smart Contract 코드의 일부가 보안에 취약한 버그가 있었다!**

그리하여 Hacker가 153,037 ETH를 가져갔고, White Hacker가 377,000 ETH를 보호하였다.
(실제 인출한 돈은 얼마 안된다고 했는데, 금액이 기억안남;;;)

Hacker Account
<br>
[https://etherscan.io/address/0xb3764761e297d6f121e79c32a65829cd1ddb4d32](https://etherscan.io/address/0xb3764761e297d6f121e79c32a65829cd1ddb4d32)

White Hacker Account
<br>
[https://etherscan.io/address/0x1dba1131000664b884a1ba238464159892252d3a](https://etherscan.io/address/0x1dba1131000664b884a1ba238464159892252d3a)
<br><br>

Parity의 Multi-Sig Wallet은 여러개의 Contract 코드를 사용하고 있으며, Contract간 연결되는 부분에서 부터 취약성이 시작되지만, [EVM, Solidity(LIBRARY, DELEGATECALL, Contract간 연결방법](http://solidity.readthedocs.io/en/develop/introduction-to-smart-contracts.html#delegatecall-callcode-and-libraries)과 [Proxy library pattern](https://blog.zeppelin.solutions/proxy-libraries-in-solidity-79fbe4b970fd)에 대해 언급하지 않고, 최대한 간단하게 [Contract 기능의 Type](http://solidity.readthedocs.io/en/develop/types.html#function-types)이나 기능의 [접근 권한](https://solidity.readthedocs.io/en/develop/contracts.html#function-modifiers)에 대해서만 요약해봄 :D
<br><br>
다중서명의 기능을 보유하고 있다면, 다중 서명을 위한 여러 소유자들에 대한 Account를 가지고 있는데 
Contract에서 최초 사용자 지갑을 초기화할때, 그 소유자들에 대한 정보를 입력 받도록 하고 있다.

그런데, 소유자 정보를 최초 설정된 이후 다시 설정 할 수 없도록 하거나, 재설정을 한다면 권한이 있는 사용자만 호출할 수 있도록 함수에 대한 접근권한을 해야한다.

하지만, 지갑의 돈을 제어할 수 있는 소유자 정보를 관련 없는 Account가 제어할 수 있도록 만들어져 있었으며, 그러한 취약점을 이용하여 Hacker는 자신이 소유자인것 처럼 설정하여 ETH를 탈취한것이다.

아래는 Wallet의 생성자 부분이며, WalletLibrary의 initWallet 함수를 사용할 수 있도록 해 놓았다.
![Wallet Contract](/assets/img/20170721_wallet_sol.png)

WalletLibrary에서 initWallet 함수가 실행되는 scope내에 보면 initDaylimit과 initMultiowned을 호출한다.
![WalletLibrary Contract](/assets/img/20170721_walletLibrary_sol.png)

위에서 언급한 initWallet 함수는 외부에서 호출이 가능하고, 소유자 Account를 설정하는 initMultiowned 함수도 역시 외부에서도 호출 가능한 함수로 정의되어 있다.
![WalletLibrary Contract](/assets/img/20170721_walletLibrary_multiowned_sol.png)

그래서 Hacker는 [이 함수의 취약성을 이용한 트랜잭션으로](https://etherscan.io/tx/0x9dbf0326a03a2a3719c27be4fa69aacc9857fd231a8d9dcaede4bb083def75ec) Multi-Sig Wallet에 보관된 [ETH를 가져간 것이다](https://etherscan.io/tx/0xeef10fc5170f669b86c4cd0444882a96087221325f8bf2f55d6188633aa7be7c).

이후, Parity에서 긴급하게 [외부에서 접근하지 못하도록 함수 Type을 변경](https://github.com/paritytech/parity/commit/b640df8fbb964da7538eef268dffc125b081a82f)하였으며,
추가로 해당 [초기화 함수에 대해 접근 권한을  추가 적용](https://github.com/paritytech/parity/commit/02d462e2636f1898df3e7556364260c594b112e6)하였다.
<br><br>
### 그래서

분산된 환경의 블록체인이든 전통적인 서버 개발이든 모든 영역에 완벽한 SW를 만드는것은 쉬운일이 아니다.

분산환경에서 동작하는 (현재 수준의) Smart Contract 개발은  기존의 보다 고민해야할 요소들이 더 있고, 다른 방식으로 고민히 필요하다. (이 이야기를 하면...주저리 주저리 정리가 안될것 같음)

어떠한 개발자든 실수를 할 수 있고, 그러한 실수로 인한 bug를 허용하지 않기 위해 진화된 Compiler,  IDE, Test Framework, CI... 등 다양한 도구나 환경을 활용하여 좋은 품질의 SW를 만드는 노력을 할 수 있다.

이번과 같은 취약성들을 Smart Contract 개발언어 측면에서도 고민하고 있는 프로젝트가 Vitalik이 주도하고 있는 Viper이다.

이더리움 블록체인의 Test Framework 가운데 Truffle(트러플)과 Embark(엠바크)가 가장 많이 사용되고 있는데, 아주 유용한 도구들이다.

개발자 측면에서 Test 도구는 반드시 필요한 영역이고, 내가 만든 코드를 나도 못 믿기 때문에 TDD(테스트 주도 개발)를 실천할 수 있도록 노력해야한다.

